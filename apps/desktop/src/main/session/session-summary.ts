// 定义会话列表里每个会话的脱敏摘要和状态集合，并从注册表记录生成摘要；preload 和渲染层也引用这里的类型。

import { basename } from "node:path"
import type { SessionEntry } from "./session-registry"
import type { SessionIndex, SessionOrigin } from "./session-index"
import type { SessionStatusView, SessionTurnEndStatus } from "./session-types"

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
  /** 项目根目录，与会话运行的 worktree 路径可以不同。 */
  projectPath?: string
  /** 由项目第一条消息自动生成或用户指定的标题。 */
  title?: string
  /** 归档时间，正在使用的会话也可归档。 */
  archivedAt?: string | null
  /** 本机保存的会话可以用原 id 续接。 */
  restorable?: boolean
  /** 定时创建的会话保留来源标记，供会话历史展示。 */
  origin?: SessionOrigin
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

/** 系统入口展示的运行会话：项目目录名、手动标题和待审批数。 */
export type LiveSessionPreview = {
  sessionId: string
  projectName: string
  title: string | null
  pendingApprovals: number
}

/** 返回允许展示在系统入口中的手动标题；自动标题来自第一条提示词。 */
export function manualSessionTitle(
  index: Pick<SessionIndex, "title" | "titleSource"> | null | undefined,
): string | null {
  return index?.titleSource === "user" ? index.title : null
}

/** 只给系统入口提供公开摘要；自动标题来自第一条提示词。 */
export function liveSessionPreview(
  entry: SessionEntry,
  saved: SessionIndex | null | undefined,
): LiveSessionPreview {
  return {
    sessionId: entry.sessionId,
    projectName: basename(saved?.projectPath ?? entry.workspace),
    title: manualSessionTitle(saved),
    pendingApprovals: entry.session?.status().pendingPermissions ?? 0,
  }
}

/** 无需启动 Claude Code 即可列出保存的会话状态。 */
export function summarizeSavedSession(index: SessionIndex): SessionSummary {
  return {
    sessionId: index.id,
    workspace: index.workspace ?? index.projectPath,
    projectPath: index.projectPath,
    ...(index.title === "" ? {} : { title: index.title }),
    archivedAt: index.archivedAt,
    status: index.status === "running" ? "parked" : index.status,
    lastTurn: index.lastTurn?.status ?? null,
    turnId: null,
    pendingPermissions: 0,
    pendingQuestions: 0,
    accountId: index.activeAccountId,
    model: index.model,
    lastActivityAt: index.lastActivityAt,
    restorable: true,
    ...(index.origin === "scheduled" ? { origin: index.origin } : {}),
  }
}

/** 从注册表记录生成摘要；停放的会话没有回合和待答数。 */
export function summarizeSession(entry: SessionEntry): SessionSummary {
  const view = entry.session?.status() ?? null
  const live = entry.phase === "running" || entry.phase === "starting"
  return {
    sessionId: entry.sessionId,
    workspace: entry.workspace,
    status: listStatus(entry, view),
    lastTurn: entry.lastTurn,
    turnId: live ? (view?.turnId ?? null) : null,
    pendingPermissions: live ? (view?.pendingPermissions ?? 0) : 0,
    pendingQuestions: live ? (view?.pendingQuestions ?? 0) : 0,
    accountId: view?.accountId ?? null,
    model: view?.model ?? null,
    lastActivityAt: new Date(entry.lastActivityAt).toISOString(),
  }
}

function listStatus(entry: SessionEntry, view: SessionStatusView | null): SessionListStatus {
  switch (entry.phase) {
    case "queued":
      return "queued"
    case "checking":
    case "starting":
      return "running"
    case "parked":
      if (entry.parkReason === null) return "failed"
      if (entry.parkReason === "membership" || entry.parkedMidTurn) return "interrupted"
      return "parked"
    case "running": {
      if (view === null) return "idle"
      if (view.pendingPermissions > 0) return "waiting-approval"
      return view.turnId === null && view.pendingQuestions === 0 ? "idle" : "running"
    }
  }
}
