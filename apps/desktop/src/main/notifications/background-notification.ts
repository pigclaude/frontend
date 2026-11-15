// 负责把后台会话事件映射为系统通知，并且只输出允许展示的字段。

import { basename } from "node:path"
import type { SessionEnvelope } from "../session/session-envelope"
import type { SessionIndex } from "../session/session-index"
import { manualSessionTitle } from "../session/session-summary"

/** 系统通知的事件和点击目标；回合正文、工具输入和错误详情不进入这个类型。 */
export type BackgroundNotice =
  SessionBackgroundNotice | { kind: "skipped"; sessionId: string | null } | { kind: "membership" }

type SessionBackgroundNotice =
  | { kind: "completed" | "failed" | "interrupted"; sessionId: string }
  | { kind: "approval"; sessionId: string; toolName: string }

/** 通知可以读取的会话索引字段；自动标题需要按来源区别处理。 */
export type NotificationSession = Pick<SessionIndex, "projectPath" | "title" | "titleSource"> & {
  projectName?: string
}

/** 传给操作系统的白名单字段。 */
export type SystemNotificationContent = { title: string; body: string }

const turnKind = { completed: "completed", error: "failed", interrupted: "interrupted" } as const
const noticeLabel: Record<BackgroundNotice["kind"], string> = {
  completed: "回合已完成",
  approval: "需要审批",
  failed: "回合失败",
  interrupted: "回合已中断",
  skipped: "已跳过",
  membership: "会员已失效",
}

/** 只使用现场权限请求及主进程确认结束的回合，忽略正文、增量和中间结果。 */
export function backgroundNoticeFromSession(
  envelope: SessionEnvelope,
): SessionBackgroundNotice | null {
  const { sessionId, event } = envelope
  if (sessionId === null) return null
  if (event.type === "permission") return { kind: "approval", sessionId, toolName: event.toolName }
  if (event.type === "turn-ended") return { kind: turnKind[event.status], sessionId }
  return null
}

/** 只展示项目名、手动命名的会话标题、事件和工具名；自动标题可能含用户的首条消息。 */
export function formatBackgroundNotice(
  notice: BackgroundNotice,
  session?: NotificationSession | null,
): SystemNotificationContent {
  const fields = [noticeLabel[notice.kind]]
  if (session) {
    const project =
      displayLabel(session.projectName ?? "") || displayLabel(basename(session.projectPath))
    if (project) fields.push(project)
    const title = displayLabel(manualSessionTitle(session) ?? "")
    if (title) fields.push(title)
  }
  if (notice.kind === "approval" && /^[A-Za-z0-9_-]{1,128}$/.test(notice.toolName)) {
    fields.push(notice.toolName)
  }
  return { title: "PigClaude", body: fields.join(" · ") }
}

function displayLabel(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").trim()
}
