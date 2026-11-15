// 负责定时会话的前置检查和 daemon 等待，只在全部条件成立时进入会话宿主。

import type { ScheduledTaskInput, ScheduledTaskOutcome } from "../../scheduled-tasks-contract"

const daemonWaitMs = 120_000
const stopped: ScheduledTaskOutcome = { status: "stopped", reason: "APP_STOPPED" }

/** 运行前读取当前会员、项目、账号和本机 daemon，并把任务快照交给会话宿主。 */
export type ScheduledTaskRunnerPorts = {
  checkMembership(): Promise<boolean>
  checkProject(projectPath: string): Promise<boolean>
  checkAccount(): Promise<boolean>
  startDaemon(): Promise<boolean>
  defaultModel(): Promise<string | null>
  runSession(task: ScheduledTaskInput, signal: AbortSignal): Promise<ScheduledTaskOutcome>
}

/** 按定时策略准备并执行一轮。退出时不会从迟到的检查结果进入会话。 */
export function createScheduledTaskRunner(ports: ScheduledTaskRunnerPorts) {
  return async (task: ScheduledTaskInput, signal: AbortSignal): Promise<ScheduledTaskOutcome> => {
    const prerequisites = [
      [() => ports.checkMembership(), "MEMBERSHIP_REQUIRED"],
      [() => ports.checkProject(task.projectPath), "PROJECT_UNAVAILABLE"],
      [() => ports.checkAccount(), "NO_AVAILABLE_ACCOUNT"],
    ] as const
    for (const [verify, reason] of prerequisites) {
      if (!(await untilAbort(verify, signal, false))) return skipped(signal, reason)
    }
    if (!(await waitForDaemon(() => ports.startDaemon(), signal)))
      return skipped(signal, "DAEMON_UNAVAILABLE")
    const model = task.model ?? (await untilAbort(() => ports.defaultModel(), signal, null))
    if (signal.aborted) return stopped
    return ports.runSession({ ...task, model }, signal)
  }
}

function skipped(signal: AbortSignal, reason: string): ScheduledTaskOutcome {
  return signal.aborted ? stopped : { status: "skipped", reason }
}

async function waitForDaemon(check: () => Promise<boolean>, signal: AbortSignal): Promise<boolean> {
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), daemonWaitMs)
  try {
    return await untilAbort(check, AbortSignal.any([signal, deadline.signal]), false)
  } finally {
    clearTimeout(timer)
  }
}

function untilAbort<T>(operation: () => Promise<T>, signal: AbortSignal, fallback: T): Promise<T> {
  if (signal.aborted) return Promise.resolve(fallback)
  return new Promise((resolve) => {
    const cancelled = () => complete(fallback)
    const complete = (result: T) => {
      signal.removeEventListener("abort", cancelled)
      resolve(result)
    }
    signal.addEventListener("abort", cancelled, { once: true })
    void Promise.resolve()
      .then(() => (signal.aborted ? fallback : operation()))
      .then(complete, cancelled)
  })
}
