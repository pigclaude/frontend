// 定义会话时间线使用的提示键，并把旧版本补写的重启提示映射到同一份语言包。

import type { SessionNoticeEvent } from "./session-types"

const keys = [
  "run.stalled",
  "host.restarted",
  "session.resumeFailed",
  "fast.unavailable",
  "fast.unavailable.extra_usage_disabled",
  "fast.unavailable.free",
  "fast.unavailable.model_not_allowed",
  "fast.unavailable.cooldown",
] as const
const knownKeys = new Set<string>(keys)

/** 时间线里的提示；键取自现有语言包，参数用于替换文案里的占位符。 */
export type TimelineNoticeEvent = {
  type: "notice"
  key: (typeof keys)[number]
  level: "info" | "warning" | "error"
  params: Record<string, string>
}

/** 读取可在时间线显示的提示，兼容旧时间线里的重启文案。 */
export function timelineNotice(
  event: SessionNoticeEvent | TimelineNoticeEvent,
): TimelineNoticeEvent | null {
  if ("key" in event) return knownKeys.has(event.key) ? event : null
  if (event.message === "应用已重启，这一轮已中断") {
    return { type: "notice", key: "host.restarted", level: "warning", params: {} }
  }
  return null
}
