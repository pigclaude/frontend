// 调度本机定时任务。先原子保存认领与游标，再把当次配置交给会话入口。

import { randomUUID } from "node:crypto"
import type {
  ScheduledTask,
  ScheduledTaskChange,
  ScheduledTaskInput,
  ScheduledTaskOutcome,
  ScheduledTaskRun,
  ScheduledTaskRunsPage,
  ScheduledTaskSummary,
} from "../../scheduled-tasks-contract"
import { claimRun, completedRun, finishRun } from "./run-history"
import {
  maximumScheduledTaskRuns,
  newestScheduledRunFirst,
  parseScheduledTaskInput,
  parseScheduledTaskOutcome,
  readScheduledTasks,
  writeScheduledTasks,
  type SavedScheduledTask,
  type ScheduledTasksFile,
} from "./store"
import {
  dueTaskRun,
  localScheduleSlot,
  nextTaskRun,
  scheduledTaskPollMs,
  systemScheduleClock,
  wallClockJumped,
  type ScheduleClock,
} from "./timing"

/** 调度的时钟与定时器端口。 */
export type { ScheduleClock } from "./timing"

/** 调用入口接收落盘后的任务快照与本次唯一认领。 */
export type ScheduledTaskRequest = { task: ScheduledTask; run: ScheduledTaskRun }

/** 调度依赖本机文件、时钟和一次新会话的执行入口。 */
export type ScheduledTaskServiceOptions = {
  filePath: string
  run(request: ScheduledTaskRequest, signal: AbortSignal): Promise<ScheduledTaskOutcome>
  clock?: ScheduleClock
  reportError?: (error: unknown) => void
}

const stoppedOnExit: ScheduledTaskOutcome = { status: "stopped", reason: "APP_STOPPED" }
const executionFailed: ScheduledTaskOutcome = { status: "failed", reason: "EXECUTION_FAILED" }

/** 一个主进程持有一个调度服务。任务写入串行，不阻塞彼此独立的会话执行。 */
export class ScheduledTaskService {
  readonly #clock: ScheduleClock
  readonly #listeners = new Set<(change: ScheduledTaskChange) => void>()
  readonly #abort = new AbortController()
  readonly #executions = new Set<Promise<void>>()
  readonly #finished = new Map<string, ScheduledTaskRun>()
  #file: ScheduledTasksFile = { version: 1, timeZone: null, tasks: [] }
  #loaded = false
  #serial = Promise.resolve()
  #startup: Promise<void> | undefined
  #disposing: Promise<void> | undefined
  #started = false
  #suspended = false
  #cancelTimer: (() => void) | undefined
  #pollDeadline: number | undefined
  #sample: { wall: number; elapsed: number } | null = null

  /** 构造服务时没有任务触发，调用 start 后启动巡检。 */
  constructor(private readonly options: ScheduledTaskServiceOptions) {
    this.#clock = options.clock ?? systemScheduleClock
  }

  /** 恢复进程退出时留下的运行记录，并补跑尚未认领的近期任务。 */
  start(): Promise<void> {
    if (this.#abort.signal.aborted) return Promise.reject(new Error("SCHEDULE_SERVICE_CLOSED"))
    return (this.#startup ??= this.#enqueue(async () => {
      this.#assertOpen()
      await this.#refresh(true, true)
      this.#started = true
      this.#arm()
    }).catch((error: unknown) => {
      this.#startup = undefined
      throw error
    }))
  }

  /** 停止自动巡检和认领，保留游标等恢复联网时重算。 */
  suspend(): void {
    this.#suspended = true
    this.#cancelTimer?.()
    this.#cancelTimer = undefined
  }

  /** 恢复联网后按同一持久化游标重算，并恢复自动巡检。 */
  async wake(): Promise<void> {
    this.#suspended = false
    await this.start()
    await this.#poll(true)
  }

  /** 读取已保存的任务配置与当前调度状态。 */
  list(): Promise<ScheduledTask[]> {
    return this.#enqueue(() => structuredClone(this.#file.tasks.map(({ task }) => task)))
  }

  /** 创建任务并保存第一处未来触发。 */
  async create(input: ScheduledTaskInput): Promise<ScheduledTask> {
    const config = parseScheduledTaskInput(input)
    return this.#changeTasks((draft) => {
      const now = this.#clock.now()
      const task: ScheduledTask = {
        ...config,
        id: randomUUID(),
        nextRunAt: nextTaskRun(config, now),
        lastRunAt: null,
        lastSessionId: null,
        runCount: 0,
      }
      draft.tasks.push({
        task,
        eligibleFrom: timestamp(now),
        handledThrough: null,
        handledLocallyThrough: null,
        active: null,
        history: [],
      })
      return task
    })
  }

  /** 保存任务编辑。只有排期字段变化时才改变既有排期。 */
  async update(id: string, input: ScheduledTaskInput): Promise<ScheduledTask> {
    const config = parseScheduledTaskInput(input)
    return this.#changeTasks((draft) => {
      const saved = findTask(draft, id)
      const old = saved.task
      const ruleChanged = JSON.stringify(old.rule) !== JSON.stringify(config.rule)
      saved.task = { ...old, ...config }
      if (ruleChanged) saved.handledLocallyThrough = null
      if (old.enabled !== config.enabled || old.endsAt !== config.endsAt || ruleChanged)
        resetPlan(saved, this.#clock.now())
      return saved.task
    })
  }

  /** 暂停后跳过停用期间的排期，恢复时安排下一次未来触发。 */
  setEnabled(id: string, enabled: boolean): Promise<ScheduledTask> {
    return this.#changeTasks((draft) => {
      const saved = findTask(draft, id)
      if (saved.task.enabled !== enabled) {
        saved.task.enabled = enabled
        resetPlan(saved, this.#clock.now())
      }
      return saved.task
    })
  }

  /** 删除任务和运行记录。已交给会话入口的运行由该会话收尾。 */
  remove(id: string): Promise<void> {
    return this.#changeTasks((draft) => {
      const saved = findTask(draft, id)
      draft.tasks.splice(draft.tasks.indexOf(saved), 1)
    })
  }

  /** 原子暂停当前启用的全部任务。 */
  pauseAll(): Promise<void> {
    return this.#changeTasks((draft) => {
      for (const { task } of draft.tasks) {
        task.enabled = false
        task.nextRunAt = null
      }
    })
  }

  /** 落盘一次立即运行。已有运行时写入跳过记录，否则后台调用会话入口。 */
  async runNow(id: string): Promise<ScheduledTaskRun> {
    await this.start()
    return this.#enqueue(async () => {
      this.#assertOpen()
      await this.#flushFinished()
      const draft = structuredClone(this.#file)
      const saved = findTask(draft, id)
      const run = claimRun(saved, null, false, this.#clock.now())
      await this.#commit(draft, [run])
      if (run.status === "running") this.#execute({ task: saved.task, run })
      return structuredClone(run)
    })
  }

  /** 从最新到最旧读取运行记录，同时保留仍在执行的认领。 */
  runs(id: string, offset = 0, limit = maximumScheduledTaskRuns): Promise<ScheduledTaskRunsPage> {
    return this.#enqueue(() => {
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1)
        throw new Error("SCHEDULE_RUN_PAGE_INVALID")
      const { active, history } = findTask(this.#file, id)
      const rows = [...(active === null ? [] : [active]), ...history].sort(newestScheduledRunFirst)
      return { runs: structuredClone(rows.slice(offset, offset + limit)), total: rows.length }
    })
  }

  /** 读取最新落盘的启用任务和最近的后续触发，不携带提示词。 */
  summary(): ScheduledTaskSummary {
    const enabled = this.#file.tasks.flatMap(({ task }) =>
      task.enabled
        ? [
            {
              id: task.id,
              projectPath: task.projectPath,
              nextRunAt: task.nextRunAt,
              lastRunAt: task.lastRunAt,
            },
          ]
        : [],
    )
    let next: ScheduledTaskSummary["next"] = null
    for (const task of enabled) {
      if (task.nextRunAt !== null && (next?.nextRunAt == null || task.nextRunAt < next.nextRunAt))
        next = task
    }
    return { next, enabled }
  }

  /** 订阅已持久化的任务与运行状态变化。 */
  subscribe(listener: (change: ScheduledTaskChange) => void): () => void {
    this.#listeners.add(listener)
    return () => void this.#listeners.delete(listener)
  }

  /** 停止巡检、中止执行入口，等待最后的运行记录保存。 */
  dispose(): Promise<void> {
    this.suspend()
    this.#abort.abort()
    return (this.#disposing ??= this.#close().catch((error: unknown) => {
      this.#disposing = undefined
      throw error
    }))
  }

  async #close(): Promise<void> {
    await this.#serial
    await Promise.all(this.#executions)
    if (this.#finished.size > 0) await this.#enqueue(() => this.#flushFinished())
    this.#listeners.clear()
  }

  #poll(force: boolean): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#suspended || this.#abort.signal.aborted) return
      this.#pollDeadline = this.#clock.monotonicNow() + scheduledTaskPollMs
      try {
        await this.#refresh(force, false)
        this.#arm()
      } catch (error) {
        this.#arm(true)
        throw error
      }
    })
  }

  async #refresh(force: boolean, recover: boolean): Promise<void> {
    await this.#flushFinished()
    const draft = structuredClone(this.#file)
    const sample = { wall: this.#clock.now(), elapsed: this.#clock.monotonicNow() }
    const timeZone = this.#clock.timeZone()
    const zoneChanged = !this.#suspended && draft.timeZone !== timeZone
    const recalculate = force || zoneChanged || wallClockJumped(this.#sample, sample)
    if (zoneChanged) draft.timeZone = timeZone
    const runs: ScheduledTaskRun[] = []
    const executions: ScheduledTaskRequest[] = []
    let changed = zoneChanged
    for (const saved of draft.tasks) {
      if (recover && saved.active !== null) {
        const stopped = completedRun(saved.active, stoppedOnExit, sample.wall)
        finishRun(saved, stopped)
        runs.push(stopped)
      }
      if (this.#suspended) continue
      if (recalculate && Date.parse(saved.eligibleFrom) > sample.wall) {
        saved.eligibleFrom = timestamp(sample.wall)
        changed = true
      }
      const planned = zoneChanged
        ? { ...saved.task, nextRunAt: nextForTask(saved, Date.parse(saved.eligibleFrom)) }
        : saved.task
      const due = dueTaskRun(planned, sample.wall, saved.handledLocallyThrough)
      if (due !== null) {
        const run = claimRun(saved, due.scheduledAt, due.missed, sample.wall)
        saved.handledThrough = timestamp(sample.wall)
        saved.handledLocallyThrough = localScheduleSlot(
          saved.task.rule,
          Date.parse(due.scheduledAt),
        )
        runs.push(run)
        if (run.status === "running") executions.push({ task: saved.task, run })
      }
      if (recalculate || due !== null) {
        const next = nextForTask(saved, sample.wall)
        changed ||= next !== saved.task.nextRunAt
        saved.task.nextRunAt = next
      }
    }
    if (changed || runs.length > 0) await this.#commit(draft, runs)
    this.#sample = sample
    for (const execution of executions) this.#execute(execution)
  }

  #execute(request: ScheduledTaskRequest): void {
    const execution = Promise.resolve()
      .then(async () => {
        const signal = this.#abort.signal
        let outcome = stoppedOnExit
        if (!signal.aborted) {
          try {
            const reported = await this.options.run(structuredClone(request), signal)
            outcome = parseScheduledTaskOutcome(reported)
          } catch {
            outcome = signal.aborted ? stoppedOnExit : executionFailed
          }
        }
        this.#finished.set(request.run.id, completedRun(request.run, outcome, this.#clock.now()))
        await this.#enqueue(() => this.#flushFinished())
      })
      .catch((error: unknown) => {
        this.#report(error)
        this.#arm(true)
      })
      .finally(() => this.#executions.delete(execution))
    this.#executions.add(execution)
  }

  async #flushFinished(): Promise<void> {
    if (this.#finished.size === 0) return
    const finished = [...this.#finished.values()]
    const draft = structuredClone(this.#file)
    const updated: ScheduledTaskRun[] = []
    for (const run of finished) {
      const saved = draft.tasks.find(({ task }) => task.id === run.taskId)
      if (saved?.active?.id !== run.id) continue
      finishRun(saved, run)
      updated.push(run)
    }
    if (updated.length > 0) await this.#commit(draft, updated)
    for (const run of finished) this.#finished.delete(run.id)
  }

  #arm(retry = false): void {
    this.#cancelTimer?.()
    if (!this.#started || this.#suspended || this.#abort.signal.aborted) return
    // 保存配置时沿用已安排的巡检截止，再和任务触发时间一起选择定时器。
    const elapsed = this.#clock.monotonicNow()
    const pollAfter = (this.#pollDeadline ??= elapsed + scheduledTaskPollMs) - elapsed
    const next = this.summary().next?.nextRunAt
    const until = next == null ? pollAfter : Date.parse(next) - this.#clock.now()
    const delay = Math.max(1, retry ? pollAfter : Math.min(pollAfter, until))
    this.#cancelTimer = this.#clock.after(delay, () => {
      this.#cancelTimer = undefined
      void this.#poll(false).catch((error: unknown) => this.#report(error))
    })
  }

  #changeTasks<T>(change: (draft: ScheduledTasksFile) => T): Promise<T> {
    return this.#enqueue(async () => {
      this.#assertOpen()
      const draft = structuredClone(this.#file)
      const result = change(draft)
      await this.#commit(draft, [])
      this.#arm()
      return structuredClone(result)
    })
  }

  async #commit(draft: ScheduledTasksFile, runs: readonly ScheduledTaskRun[]): Promise<void> {
    await writeScheduledTasks(this.options.filePath, draft)
    this.#file = draft
    this.#emit({ type: "tasks" })
    for (const run of runs) this.#emit({ type: "run", run })
  }

  #emit(change: ScheduledTaskChange): void {
    for (const listener of this.#listeners) {
      try {
        listener(structuredClone(change))
      } catch (error) {
        this.#report(error)
      }
    }
  }

  #report(error: unknown): void {
    try {
      this.options.reportError?.(error)
    } catch {
      // 诊断由调用方负责，调度仍会重试写入。
    }
  }

  #assertOpen(): void {
    if (this.#abort.signal.aborted) throw new Error("SCHEDULE_SERVICE_CLOSED")
  }

  #enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.#serial.then(async () => {
      if (!this.#loaded) {
        this.#file = await readScheduledTasks(this.options.filePath)
        this.#loaded = true
      }
      return operation()
    })
    this.#serial = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

function findTask(file: ScheduledTasksFile, id: string): SavedScheduledTask {
  const saved = file.tasks.find(({ task }) => task.id === id)
  if (saved === undefined) throw new Error("SCHEDULE_TASK_NOT_FOUND")
  return saved
}

function nextForTask(saved: SavedScheduledTask, now: number): string | null {
  return nextTaskRun(
    saved.task,
    saved.handledThrough === null ? now : Math.max(now, Date.parse(saved.handledThrough)),
    saved.handledLocallyThrough,
  )
}

function resetPlan(saved: SavedScheduledTask, now: number): void {
  saved.eligibleFrom = timestamp(now)
  saved.task.nextRunAt = nextForTask(saved, now)
}

function timestamp(ms: number): string {
  return new Date(ms).toISOString()
}
