// 负责把 SDK 上下文占用查询（summary 模式）的回复换成会话的 context 事件：已用 token、窗口上限和自动压缩线。
// 只读回复里的几个数字字段，不信任它们的类型。纯函数。

/** 会话当前的上下文占用；上限或自动压缩线拿不到、自动压缩关闭时为 null。 */
export type SessionContextEvent = {
  type: "context"
  usedTokens: number
  maxTokens: number | null
  autoCompactTokens: number | null
}

/**
 * 把一次 getContextUsage 的回复换成 context 事件。字段名按随包 SDK 的实际回复（camelCase）读；
 * 已用 token 不是有限数字时返回 null，表示这次查询没有可用的结果。
 */
export function contextEventFromReply(reply: unknown): SessionContextEvent | null {
  if (typeof reply !== "object" || reply === null) return null
  const fields = reply as Record<string, unknown>
  const used = fields.totalTokens
  if (typeof used !== "number" || !Number.isFinite(used)) return null
  return {
    type: "context",
    usedTokens: Math.max(0, Math.round(used)),
    maxTokens: positive(fields.maxTokens),
    autoCompactTokens:
      fields.isAutoCompactEnabled === false ? null : positive(fields.autoCompactThreshold),
  }
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null
}
