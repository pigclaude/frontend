// 在同一个会话里，将 SDK 权限检查认出的子代理交给后续 MCP 审批。

import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk"

/** SDK 工具审批回调里用于关联一次 MCP 调用的本地数据。 */
export type McpApprovalCaller = Pick<Parameters<CanUseTool>[2], "agentID" | "signal" | "toolUseID">
type Attribution = { agentId: string | undefined; release: () => void }

const lifetimeMs = 60_000
const maximumPending = 256
const toolUseMetadata = "claudecode/toolUseId"

/** 按登记工具全名和 SDK 的调用 ID 保留一次性归属，缺少匹配时留给原审批流程。 */
export class McpApprovalAttribution {
  readonly #pending = new Map<string, Attribution>()

  /** 关联属于这个会话，停止时清除所有尚未收到 MCP 调用的记录。 */
  constructor(private readonly session: AbortSignal) {
    session.addEventListener(
      "abort",
      () => {
        for (const entry of this.#pending.values()) entry.release()
      },
      { once: true },
    )
  }

  /** 记录受信 SDK 回调的归属，到期或回调取消时释放。 */
  remember(toolName: string, { toolUseID, agentID, signal }: McpApprovalCaller): void {
    if (this.session.aborted || signal.aborted || !toolUseID) return
    const key = JSON.stringify([toolName, toolUseID])
    const existing = this.#pending.get(key)
    if (existing !== undefined) {
      if (existing.agentId !== agentID) existing.agentId = undefined
      return
    }
    if (this.#pending.size >= maximumPending) this.#pending.values().next().value?.release()
    const release = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", release)
      this.#pending.delete(key)
    }
    const timer = setTimeout(release, lifetimeMs).unref()
    this.#pending.set(key, { agentId: agentID, release })
    signal.addEventListener("abort", release, { once: true })
  }

  /** 随包 CLI 在 MCP 元数据中带同一个 toolUseID；匹配一次后立即移除。 */
  take(toolName: string, metadata: Record<string, unknown> | undefined): string | undefined {
    const id = metadata?.[toolUseMetadata]
    if (typeof id !== "string") return undefined
    const entry = this.#pending.get(JSON.stringify([toolName, id]))
    entry?.release()
    return entry?.agentId
  }
}
