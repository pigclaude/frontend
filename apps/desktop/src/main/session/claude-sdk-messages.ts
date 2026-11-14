// 负责把 SDK 消息归一化为应用的会话事件：只取界面和用量需要的字段，忽略不认识的消息和内容块。

import type { ModelUsage, SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { readBackgroundTaskSignal } from "./background-tasks"
import { readSubagentTaskSignal, subagentRef } from "./subagent-tasks"
import type {
  AdapterEvent,
  SessionContentBlock,
  SessionEvent,
  SessionUsage,
  SubagentRef,
} from "./session-events"

/** 把一条 SDK 消息换成按发出顺序排列的会话事件和后台任务信号；不认识的消息返回空数组。 */
export function normalizeSdkMessage(message: SDKMessage): AdapterEvent[] {
  switch (message.type) {
    case "system": {
      const signals = [readBackgroundTaskSignal(message), readSubagentTaskSignal(message)]
      const read = signals.filter((signal) => signal !== null)
      if (read.length > 0) return read
      if (message.subtype === "init") {
        return [
          {
            type: "started",
            sessionId: message.session_id,
            model: message.model,
            tools: [...message.tools],
            permissionMode: message.permissionMode,
          },
        ]
      }
      if (message.subtype === "status" && message.permissionMode !== undefined) {
        return [{ type: "mode", permissionMode: message.permissionMode }]
      }
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
    case "user":
      return toolResults(
        message.message.content,
        subagentRef(
          message.parent_tool_use_id,
          "agent_id" in message ? message.agent_id : undefined,
        ),
      )
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

function toolResults(content: unknown, subagent: SubagentRef | null): SessionEvent[] {
  if (!Array.isArray(content)) return []
  const events: SessionEvent[] = []
  for (const block of content) {
    if (!isRecord(block) || block.type !== "tool_result") continue
    if (typeof block.tool_use_id !== "string") continue
    events.push({
      type: "tool-result",
      toolUseId: block.tool_use_id,
      content: toolResultText(block.content),
      isError: block.is_error === true,
      subagent,
    })
  }
  return events
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
