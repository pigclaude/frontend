// 负责从一个会话的信封里取输入框圆环要显示的上下文占用：最近一条 context 事件和它的时间。纯函数。

import type { ContextUsage } from "@pigclaude/ui-composer"
import type { SessionEnvelope } from "../../../main/session/session-envelope"

/** 会话当前的上下文占用和主进程报来它的时间。 */
export type SessionContextUsage = { usage: ContextUsage; at: string }

/** 按序号取最近一条 context 事件；这个会话还没报过占用时为 null。换号不清空。 */
export function latestSessionContext(
  envelopes: readonly SessionEnvelope[],
): SessionContextUsage | null {
  let latest: SessionContextUsage | null = null
  for (const { event, at } of envelopes) {
    if (event.type !== "context") continue
    const { usedTokens, maxTokens, autoCompactTokens } = event
    latest = { usage: { usedTokens, maxTokens, autoCompactTokens }, at }
  }
  return latest
}
