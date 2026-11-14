// 负责预加载脚本放行哪些会话事件：只把会话宿主会广播的事件类型交给渲染进程。

import type { SessionHostEvent } from "../main/session/session-types"

// 键必须和会话宿主的事件类型一一对应；宿主新增事件类型时，这里不补就编译不过。
const sessionEventTypes: Record<SessionHostEvent["type"], true> = {
  started: true,
  mode: true,
  delta: true,
  message: true,
  "tool-result": true,
  permission: true,
  "account-switched": true,
  notice: true,
  result: true,
  error: true,
  ended: true,
}

/** 判断主进程发来的值是不是会话事件；类型不在会话宿主的事件列表里时不放行。 */
export function isSessionEvent(value: unknown): value is SessionHostEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    Object.hasOwn(sessionEventTypes, value.type)
  )
}
