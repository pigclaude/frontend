// 负责会话宿主的会话注册表：每个会话一条记录（排队、启动中、运行中、停放），记下最近活动、最后一轮的结果、
// 停放的原因和会话专用的工具，并回答快照、摘要、空闲判断和「某个工作区有没有进行中的回合」。
// 不启动、不停止 Claude Code。

import { isAbsolute, relative, resolve, sep } from "node:path"
import type { ClaudeSession } from "./claude-session"
import type { SessionEnvelope } from "./session-envelope"
import type { SessionIndex, SessionStoreStatus } from "./session-index"
import { buildStatusView, noPendingWork, type SessionPendingWork } from "./session-host-support"
import { summarizeSavedSession, summarizeSession, type SessionSummary } from "./session-summary"
import type { SessionErrorCode, SessionStatusView, SessionTurnEndStatus } from "./session-types"

/** 一个会话在宿主里的阶段：检查启动条件、等名额、正在启动、运行中或已停放。 */
export type SessionPhase = "checking" | "queued" | "starting" | "running" | "parked"

/** 宿主主动停放会话的原因；Claude Code 自己退出时没有原因。 */
export type SessionParkReason = "stop" | "idle" | "membership"

/** 打断一次启动的原因。 */
export type SessionCancelCode = Extract<
  SessionErrorCode,
  "SESSION_CANCELLED" | "MEMBERSHIP_REQUIRED"
>

/** 注册表里一个会话的记录；只有会话宿主会修改它。 */
export type SessionEntry = {
  readonly sessionId: string
  readonly workspace: string
  /** 启动时确认的真实路径，供工作台识别同一目录。 */
  canonicalWorkspace: string | null
  phase: SessionPhase
  /** 启动拿到名额之后才有；停放后仍保留，用于补拉事件和摘要。 */
  session: ClaudeSession | null
  /** 排队和启动期间的那一次启动；重复启动同一个会话时共用。 */
  launch: Promise<{ sessionId: string }> | null
  cancelled: SessionCancelCode | null
  parkReason: SessionParkReason | null
  /** 停放时还有进行中的一轮。 */
  parkedMidTurn: boolean
  lastTurn: SessionTurnEndStatus | null
  /** 这代 CLI 已完成回合，可为排队者让出名额。 */
  ranTurn: boolean
  lastActivityAt: number
  /** Claude Code 报告的在途后台任务数，含回合不等的后台 shell；不为 0 时不算空闲。 */
  backgroundTasks: number
  closeTools: (() => void) | null
}

/** 已释放的运行会话在磁盘上的状态。 */
function parkedSessionStatus(entry: SessionEntry): SessionStoreStatus {
  if (entry.parkReason === null) return "failed"
  return entry.parkedMidTurn || entry.parkReason === "membership" ? "interrupted" : "parked"
}

/** 宿主的会话注册表。保证同一个会话 id 只有一条记录；按加入顺序遍历。 */
export class SessionRegistry {
  readonly #entries = new Map<string, SessionEntry>()

  /** 按 id 查记录；没有时返回 null。 */
  get(sessionId: string): SessionEntry | null {
    return this.#entries.get(sessionId) ?? null
  }

  /** 只有运行会话释放时需要把停放状态写入磁盘。 */
  statusOnRelease(entry: SessionEntry): SessionStoreStatus | null {
    if (entry.phase !== "running") return null
    return parkedSessionStatus(entry)
  }

  /** 为等待启动检查的新会话登记 id；id 已存在时抛错，不覆盖。 */
  add(sessionId: string, workspace: string, now: number): SessionEntry {
    if (this.#entries.has(sessionId)) throw new Error("session id already registered")
    const entry: SessionEntry = {
      sessionId,
      workspace,
      canonicalWorkspace: null,
      phase: "checking",
      session: null,
      launch: null,
      cancelled: null,
      parkReason: null,
      parkedMidTurn: false,
      lastTurn: null,
      ranTurn: false,
      lastActivityAt: now,
      backgroundTasks: 0,
      closeTools: null,
    }
    this.#entries.set(sessionId, entry)
    return entry
  }

  /** 让同一个会话重新排队，清理上一代进程的状态。 */
  prepareResume(index: SessionIndex, now: number): SessionEntry {
    const entry =
      this.get(index.id) ?? this.add(index.id, index.workspace ?? index.projectPath, now)
    entry.phase = "checking"
    entry.parkReason = null
    entry.parkedMidTurn = false
    entry.cancelled = null
    entry.backgroundTasks = 0
    entry.lastTurn = index.lastTurn?.status ?? null
    entry.ranTurn = false
    return entry
  }

  /** 移除一条记录（启动失败或被取消的会话）。 */
  delete(entry: SessionEntry): void {
    if (this.#entries.get(entry.sessionId) === entry) this.#entries.delete(entry.sessionId)
  }

  /** 删除磁盘会话后移除其已停放的内存记录。 */
  remove(id: string): void {
    const entry = this.get(id)
    if (entry?.phase === "parked") this.delete(entry)
  }

  /** 全部记录，按加入顺序。 */
  all(): SessionEntry[] {
    return [...this.#entries.values()]
  }

  /** 停止指定会话或全部会话后，等待取消的启动请求清理磁盘。 */
  async drainLaunches(id: string | undefined, stop: () => Promise<void>): Promise<void> {
    const entries = id === undefined ? this.all() : [this.get(id)]
    const drained = Promise.allSettled(entries.map((entry) => entry?.launch))
    await stop()
    await drained
  }

  /** 记下会话发出的一条事件：更新最近活动时间，回合结束时记下这一轮的结果。 */
  observe(entry: SessionEntry, envelope: SessionEnvelope, now: number): void {
    entry.lastActivityAt = now
    if (envelope.event.type === "turn-ended") {
      entry.lastTurn = envelope.event.status
      entry.ranTurn = true
    }
  }

  /** 空闲，并且结束过至少一轮：可以停放来给排队的会话腾位置。 */
  evictable(sessionId: string): boolean {
    return this.isIdle(sessionId) && this.get(sessionId)?.ranTurn === true
  }

  /** Claude Code 在运行、没在结束，也没有进行中的回合、待答的权限和提问或后台任务。 */
  isIdle(sessionId: string): boolean {
    const entry = this.get(sessionId)
    const session = entry?.session ?? null
    if (entry === null || entry.phase !== "running" || session === null || session.closing) {
      return false
    }
    const status = session.status()
    return (
      status.turnId === null &&
      status.pendingPermissions === 0 &&
      status.pendingQuestions === 0 &&
      entry.backgroundTasks === 0
    )
  }

  /** 正在启动或运行、还没在结束的会话；其他情况返回 null。 */
  live(sessionId: string): ClaudeSession | null {
    const entry = this.get(sessionId)
    if (entry === null || entry.session === null || entry.phase === "parked") return null
    return entry.session.closing ? null : entry.session
  }

  /**
   * 指定会话的脱敏快照；排队和停放的会话 active 为 false、没有回合和待答，会话不存在时返回 null。
   * 不带 id 时给最近启动、还在运行的会话，没有时所有 id 和模型为 null。
   */
  status(sessionId?: string, saved?: SessionIndex | null): SessionStatusView | null {
    if (sessionId === undefined) {
      const latest = this.all().findLast((entry) => this.live(entry.sessionId) !== null)
      return latest?.session?.status() ?? buildStatusView(null)
    }
    const entry = this.get(sessionId)
    if (entry === null) {
      return saved == null
        ? null
        : {
            ...buildStatusView(null),
            sessionId,
            model: saved.model,
            permissionMode: saved.permissionMode,
            accountId: saved.activeAccountId,
          }
    }
    const live = this.live(sessionId)
    if (live !== null) return live.status()
    return {
      ...(entry.session?.status() ?? buildStatusView(null)),
      active: false,
      sessionId,
      turnId: null,
      pendingPermissions: 0,
      pendingQuestions: 0,
    }
  }

  /** 全部会话的脱敏摘要，最近活动的在前。 */
  summaries(stored: readonly SessionIndex[] = [], archived = false): SessionSummary[] {
    const summaries = new Map(stored.map((index) => [index.id, summarizeSavedSession(index)]))
    for (const entry of this.#entries.values()) {
      const saved = summaries.get(entry.sessionId)
      const current = summarizeSession(entry)
      summaries.set(entry.sessionId, {
        ...saved,
        ...current,
        model: current.model ?? saved?.model ?? null,
        accountId: current.accountId ?? saved?.accountId ?? null,
      })
    }
    return [...summaries.values()]
      .filter((item) => (item.archivedAt != null) === archived)
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
  }

  /** 汇总仍在运行的会话、进行中的回合和待审批请求，覆盖没有显示的会话。 */
  pendingWork(): SessionPendingWork {
    const total = { ...noPendingWork }
    for (const entry of this.#entries.values()) {
      const session = this.live(entry.sessionId)
      if (session === null) continue
      const work = session.pendingWork()
      total.runningSessions += work.runningSessions
      total.turns += work.turns
      total.approvals += work.approvals
    }
    return total
  }

  /** 和这个工作区重叠（相同、包含或被包含）的会话里有没有进行中的回合；停放和正在结束的会话不算。 */
  hasActiveTurn(workspace: string): boolean {
    return this.all().some((entry) => {
      const session = this.live(entry.sessionId)
      return (
        session?.status().turnId != null &&
        (overlaps(entry.workspace, workspace) ||
          (entry.canonicalWorkspace !== null && overlaps(entry.canonicalWorkspace, workspace)))
      )
    })
  }
}

function overlaps(left: string, right: string): boolean {
  const a = comparable(left)
  const b = comparable(right)
  return contains(a, b) || contains(b, a)
}

function comparable(path: string): string {
  const resolved = resolve(path)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === "" || (path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path))
}
