// 负责把 SDK 消息归一化为应用的会话事件：只取界面和用量需要的字段，忽略不认识的消息和内容块。

import type { ModelUsage, SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { readBackgroundTaskSignal } from "./background-tasks"
import { subagentRef } from "./subagent-tasks"
import { readTaskSignal } from "./task-signals"
import type {
  AdapterEvent,
  SessionContentBlock,
  SessionEvent,
  SessionToolResultImage,
  SessionUsage,
  SubagentRef,
} from "./session-events"

/** 把一条 SDK 消息换成按发出顺序排列的会话事件、后台任务信号和上下文压缩信号；不认识的消息返回空数组。 */
export function normalizeSdkMessage(message: SDKMessage): AdapterEvent[] {
  switch (message.type) {
    case "system": {
      const signals = [readBackgroundTaskSignal(message), readTaskSignal(message)]
      const read = signals.filter((signal) => signal !== null)
      if (read.length > 0) return read
      if (message.subtype === "init") {
        const state = message.fast_mode_state
        const reason = message.fast_mode_disabled_reason
        return [
          {
            type: "started",
            sessionId: message.session_id,
            model: message.model,
            tools: [...message.tools],
            permissionMode: message.permissionMode,
            ...(state === undefined
              ? {}
              : { fastMode: { state, ...(reason === undefined ? {} : { reason }) } }),
          },
        ]
      }
      if (message.subtype === "status" && message.permissionMode !== undefined) {
        return [{ type: "mode", permissionMode: message.permissionMode }]
      }
      if (message.subtype === "compact_boundary") return [{ type: "context-compacted" }]
      return []
    }
    case "stream_event":
      return streamDelta(message.event)
    case "assistant": {
      const events: SessionEvent[] = [
        {
          type: "message",
          messageId: message.message.id,
          model: message.message.model,
          subagent: subagentRef(message.parent_tool_use_id, message.agent_id),
          blocks: mapContentBlocks(message.message.content),
        },
      ]
      if (message.error !== undefined) {
        events.push({
          type: "error",
          code: "SDK_ERROR",
          message: `assistant error: ${message.error}`,
        })
      }
      return events
    }
    case "user": {
      if (localSkillPermissionDenied(message.message.content)) {
        return [
          {
            type: "error",
            code: "SDK_ERROR",
            message: "此 skill 的内联命令未获许可。请检查 skill 声明的 allowed-tools 后再试。",
          },
        ]
      }
      return toolResults(
        message.message.content,
        subagentRef(
          message.parent_tool_use_id,
          "agent_id" in message ? message.agent_id : undefined,
        ),
        "tool_use_result" in message && isBackgroundLaunch(message.tool_use_result),
      )
    }
    case "result": {
      const totalUsage = sumModelUsage(message.modelUsage)
      return [
        {
          type: "result",
          subtype: message.subtype,
          isError: message.is_error,
          durationMs: message.duration_ms,
          numTurns: message.num_turns,
          stopReason: message.stop_reason,
          usage: {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
            cacheReadTokens: message.usage.cache_read_input_tokens,
            cacheCreationTokens: message.usage.cache_creation_input_tokens,
          },
          ...(totalUsage === null ? {} : { totalUsage }),
        },
      ]
    }
    default:
      return []
  }
}

function localSkillPermissionDenied(content: unknown): boolean {
  const blocks = Array.isArray(content) ? content : [content]
  return blocks.some((block) => {
    const text = isRecord(block) && block.type === "text" ? block.text : block
    return (
      typeof text === "string" &&
      text.startsWith("<local-command-stderr>Shell command permission check failed") &&
      text.endsWith("</local-command-stderr>")
    )
  })
}

// modelUsage 是整个 CLI 进程到这里为止的累计，含子代理和工作流。
function sumModelUsage(modelUsage: Record<string, ModelUsage> | undefined): SessionUsage | null {
  if (!isRecord(modelUsage)) return null
  const total: SessionUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  }
  for (const usage of Object.values(modelUsage)) {
    if (!isRecord(usage)) continue
    total.inputTokens += count(usage.inputTokens)
    total.outputTokens += count(usage.outputTokens)
    total.cacheReadTokens += count(usage.cacheReadInputTokens)
    total.cacheCreationTokens += count(usage.cacheCreationInputTokens)
  }
  return total
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function streamDelta(event: unknown): SessionEvent[] {
  if (!isRecord(event) || event.type !== "content_block_delta") return []
  const delta = event.delta
  if (!isRecord(delta)) return []
  const blockIndex = typeof event.index === "number" ? event.index : 0
  if (delta.type === "text_delta" && typeof delta.text === "string") {
    return [{ type: "delta", text: delta.text, thinking: false, blockIndex }]
  }
  if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
    return [{ type: "delta", text: delta.thinking, thinking: true, blockIndex }]
  }
  return []
}

function toolResults(
  content: unknown,
  subagent: SubagentRef | null,
  backgroundLaunch: boolean,
): SessionEvent[] {
  if (!Array.isArray(content)) return []
  const events: SessionEvent[] = []
  for (const block of content) {
    if (!isRecord(block) || block.type !== "tool_result") continue
    if (typeof block.tool_use_id !== "string") continue
    const image = toolResultImage(block.content)
    events.push({
      type: "tool-result",
      toolUseId: block.tool_use_id,
      content: toolResultText(block.content),
      ...(image === undefined ? {} : { image }),
      isError: block.is_error === true,
      subagent,
      ...(backgroundLaunch ? { backgroundLaunch } : {}),
    })
  }
  return events
}

function toolResultImage(content: unknown): SessionToolResultImage | undefined {
  if (!Array.isArray(content)) return undefined
  for (const block of content) {
    if (!isRecord(block) || block.type !== "image") continue
    const source =
      isRecord(block.source) && block.source.type === "base64" ? block.source : undefined
    const mime = source?.media_type ?? block.mimeType
    const data = source?.data ?? block.data
    if (
      mime === "image/jpeg" &&
      typeof data === "string" &&
      data.length <= 2 * 1024 * 1024 &&
      data.length % 4 === 0 &&
      data.startsWith("/9j/") &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(data)
    )
      return { type: "image", mimeType: "image/jpeg", data }
  }
  return undefined
}

// CLI 在消息的工具结果元数据里用 status 标出只在后台启动了任务的结果。
function isBackgroundLaunch(result: unknown): boolean {
  return isRecord(result) && result.status === "async_launched"
}

function mapContentBlocks(content: unknown): SessionContentBlock[] {
  if (!Array.isArray(content)) return []
  const blocks: SessionContentBlock[] = []
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block.type === "text" && typeof block.text === "string") {
      blocks.push({ type: "text", text: block.text })
    } else if (block.type === "thinking" && typeof block.thinking === "string") {
      blocks.push({ type: "thinking", text: block.thinking })
    } else if (block.type === "tool_use" && typeof block.id === "string") {
      blocks.push({
        type: "tool-use",
        id: block.id,
        name: typeof block.name === "string" ? block.name : "unknown",
        input: block.input,
      })
    }
  }
  return blocks
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  const parts: string[] = []
  for (const block of content) {
    if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
      parts.push(block.text)
    }
  }
  return parts.join("")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
