// 负责把流式增量和完整 assistant 消息合并进一轮对话；按消息 id 去重，工具按 id 只保留一条。
// 文字块记下最后一次更新的时间，工具记下第一次出现的时间。

import type { SessionHostEvent } from "../../../main/session/session-types"
import type { SessionTurn } from "./session-model"

/** 把文本或思考增量追加到最后一个同类型块；没有同类型块时新建。 */
export function appendDelta(
  turn: SessionTurn,
  text: string,
  thinking: boolean,
  at: string,
): SessionTurn {
  if (text === "") return turn
  const kind = thinking ? "thinking" : "text"
  const last = turn.blocks[turn.blocks.length - 1]
  if (last?.type === kind) {
    const blocks = [...turn.blocks]
    blocks[blocks.length - 1] = { type: kind, text: last.text + text, at }
    return { ...turn, blocks }
  }
  return { ...turn, blocks: [...turn.blocks, { type: kind, text, at }] }
}

/** 合并一条完整 assistant 消息；重复 messageId 直接忽略，工具调用按 id 合并。 */
export function appendMessage(
  turn: SessionTurn,
  message: Extract<SessionHostEvent, { type: "message" }>,
  at: string,
): SessionTurn {
  // 同一条 SDK 消息会分多次推送（thinking、tool-use、text 逐步累积），
  // 所以同 id 也要继续处理：工具块按 id 幂等合并，文本由 mergeFullText 去重。
  const seen = turn.seenMessageIds.includes(message.messageId)
  let next: SessionTurn = seen
    ? turn
    : { ...turn, seenMessageIds: [...turn.seenMessageIds, message.messageId] }
  for (const block of message.blocks) {
    if (block.type === "tool-use") {
      next = upsertTool(next, block.id, block.name, block.input, at)
    } else {
      next = mergeFullText(next, block.type, block.text, at)
    }
  }
  return next
}

function mergeFullText(
  turn: SessionTurn,
  kind: "text" | "thinking",
  text: string,
  at: string,
): SessionTurn {
  if (text === "") return turn
  const index = turn.blocks.length - 1
  const last = turn.blocks[index]
  if (last?.type === kind) {
    const blocks = [...turn.blocks]
    blocks[index] = { type: kind, text: mergeText(last.text, text), at }
    return { ...turn, blocks }
  }
  // 只合并紧邻的同类块；已经通过增量到达的同一段文本不再重复追加。
  if (turn.blocks.some((block) => block.type === kind && block.text.startsWith(text))) return turn
  return { ...turn, blocks: [...turn.blocks, { type: kind, text, at }] }
}

// 流式增量已经到达时，完整消息只补齐缺失的后缀，避免界面重复。
function mergeText(streamed: string, full: string): string {
  if (streamed === "") return full
  if (full === "" || streamed.endsWith(full) || streamed.startsWith(full)) return streamed
  if (full.startsWith(streamed)) return full
  return `${streamed}${full}`
}

function upsertTool(
  turn: SessionTurn,
  id: string,
  name: string,
  input: unknown,
  at: string,
): SessionTurn {
  const existing = turn.tools.find((tool) => tool.id === id)
  if (existing === undefined) {
    return {
      ...turn,
      tools: [
        ...turn.tools,
        { id, name, input, status: "running", output: null, startedAt: at, endedAt: null },
      ],
      blocks: [...turn.blocks, { type: "tool", id }],
    }
  }
  return {
    ...turn,
    tools: turn.tools.map((tool) =>
      tool.id === id ? { ...tool, name, input, status: "running" } : tool,
    ),
  }
}
