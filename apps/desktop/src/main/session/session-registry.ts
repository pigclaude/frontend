// 负责会话宿主的会话注册表：每个会话一条记录（排队、启动中、运行中、停放），记下最近活动、最后一轮的结果、
// 停放的原因和会话专用的工具，并回答快照、摘要、空闲判断和「某个工作区有没有进行中的回合」。
// 不启动、不停止 Claude Code。

import { isAbsolute, relative, resolve } from "node:path"
import type { ClaudeSession } from "./claude-session"
import type { SessionEnvelope } from "./session-envelope"
import { buildStatusView, noPendingWork, type SessionPendingWork } from "./session-host-support"
import { summarizeSession, type SessionSummary } from "./session-summary"
import type { SessionErrorCode, SessionStatusView, SessionTurnEndStatus } from "./session-types"

/** 一个会话在宿主里的阶段：等名额、正在启动、Claude Code 在运行、进程已结束但会话还留着。 */
export type SessionPhase = "queued" | "starting" | "running" | "parked"

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
  lastActivityAt: number
  /** Claude Code 报告的在途后台任务数，含回合不等的后台 shell；不为 0 时不算空闲。 */
  backgroundTasks: number
  closeTools: (() => void) | null
}

/** 宿主的会话注册表。保证同一个会话 id 只有一条记录；按加入顺序遍历。 */
export class SessionRegistry {
  readonly #entries = new Map<string, SessionEntry>()

  /** 按 id 查记录；没有时返回 null。 */
  get(sessionId: string): SessionEntry | null {
    return this.#entries.get(sessionId) ?? null
  }

  /** 加入一个排队中的新会话；id 已存在时抛错，不覆盖。 */
  add(sessionId: string, workspace: string, now: number): SessionEntry {
    if (this.#entries.has(sessionId)) throw new Error("session id already registered")
    const entry: SessionEntry = {
      sessionId,
      workspace,
      phase: "queued",
      session: null,
      launch: null,
      cancelled: null,
      parkReason: null,
      parkedMidTurn: false,
      lastTurn: null,
      lastActivityAt: now,
      backgroundTasks: 0,
      closeTools: null,
    }
    this.#entries.set(sessionId, entry)
    return entry
  }

  /** 移除一条记录（启动失败或被取消的会话）。 */
  delete(entry: SessionEntry): void {
    if (this.#entries.get(entry.sessionId) === entry) this.#entries.delete(entry.sessionId)
  }

  /** 全部记录，按加入顺序。 */
  all(): SessionEntry[] {
    return [...this.#entries.values()]
  }

  /** 记下会话发出的一条事件：更新最近活动时间，回合结束时记下这一轮的结果。 */
  observe(entry: SessionEntry, envelope: SessionEnvelope, now: number): void {
    entry.lastActivityAt = now
    if (envelope.event.type === "turn-ended") entry.lastTurn = envelope.event.status
  }

  /** 空闲，并且结束过至少一轮：可以停放来给排队的会话腾位置。 */
  evictable(sessionId: string): boolean {
    return this.isIdle(sessionId) && this.get(sessionId)?.lastTurn != null
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
  status(sessionId?: string): SessionStatusView | null {
    if (sessionId === undefined) {
      const latest = this.all().findLast((entry) => this.live(entry.sessionId) !== null)
      return latest?.session?.status() ?? buildStatusView(null)
    }
    const entry = this.get(sessionId)
    if (entry === null) return null
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
  summaries(): SessionSummary[] {
    return this.all()
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .map(summarizeSession)
  }

  /** 所有会话里退出会中断的工作：进行中的回合和等待回答的权限；正在结束的会话不算。 */
  pendingWork(): SessionPendingWork {
    return this.all().reduce((total, entry) => {
      const work = entry.session?.pendingWork() ?? noPendingWork
      return { turns: total.turns + work.turns, approvals: total.approvals + work.approvals }
    }, noPendingWork)
  }

  /** 和这个工作区重叠（相同、包含或被包含）的会话里有没有进行中的回合；停放和正在结束的会话不算。 */
  hasActiveTurn(workspace: string): boolean {
    return this.all().some((entry) => {
      const session = this.live(entry.sessionId)
      return session?.status().turnId != null && overlaps(entry.workspace, workspace)
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
  return path === "" || (!path.startsWith("..") && !isAbsolute(path))
}
