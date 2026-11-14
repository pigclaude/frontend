// 定义会话列表里每个会话的脱敏摘要和状态集合，并从注册表记录生成摘要；preload 和渲染层也引用这里的类型。

import type { SessionEntry } from "./session-registry"
import type { SessionTurnEndStatus } from "./session-types"

/**
 * 会话在列表里的状态。queued 等名额；running 有进行中的回合（含正在启动）；waiting-approval 这一轮在等权限回答；
 * idle 是 Claude Code 在运行但没有回合；parked 是进程已结束、会话还在；interrupted 是停放时打断了进行中的一轮
 * 或会员失效；failed 是 Claude Code 自己退出。停放类状态的上一轮结果看 lastTurn。
 */
export type SessionListStatus =
  "queued" | "running" | "waiting-approval" | "idle" | "parked" | "interrupted" | "failed"

/** 一个会话的脱敏摘要；不含令牌、环境变量、代理地址或对话内容。 */
export type SessionSummary = {
  sessionId: string
  workspace: string
  status: SessionListStatus
  /** 最后一轮怎么结束的；还没有结束过的回合时为 null。 */
  lastTurn: SessionTurnEndStatus | null
  turnId: string | null
  pendingPermissions: number
  pendingQuestions: number
  /** 实际在用的账号；还没选过号时为 null。 */
  accountId: string | null
  model: string | null
  /** 最近一次活动的时间，ISO UTC。 */
  lastActivityAt: string
}

/** 从注册表记录生成摘要；停放的会话没有回合和待答数。 */
export function summarizeSession(entry: SessionEntry): SessionSummary {
  const view = entry.session?.status() ?? null
  const live = entry.phase === "running" || entry.phase === "starting"
  return {
    sessionId: entry.sessionId,
    workspace: entry.workspace,
    status: listStatus(entry),
    lastTurn: entry.lastTurn,
    turnId: live ? (view?.turnId ?? null) : null,
    pendingPermissions: live ? (view?.pendingPermissions ?? 0) : 0,
    pendingQuestions: live ? (view?.pendingQuestions ?? 0) : 0,
    accountId: view?.accountId ?? null,
    model: view?.model ?? null,
    lastActivityAt: new Date(entry.lastActivityAt).toISOString(),
  }
}

function listStatus(entry: SessionEntry): SessionListStatus {
  switch (entry.phase) {
    case "queued":
      return "queued"
    case "starting":
      return "running"
    case "parked":
      if (entry.parkReason === null) return "failed"
      if (entry.parkReason === "membership" || entry.parkedMidTurn) return "interrupted"
      return "parked"
    case "running": {
      const view = entry.session?.status()
      if (view === undefined) return "idle"
      if (view.pendingPermissions > 0) return "waiting-approval"
      return view.turnId === null && view.pendingQuestions === 0 ? "idle" : "running"
    }
  }
}
