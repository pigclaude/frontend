// 负责把流式增量和完整 assistant 消息合并进一轮对话；按消息 id 去重，工具按 id 只保留一条。

import type { SessionHostEvent } from "../../../main/session/session-types"
import type { SessionBlock, SessionTurn } from "./session-model"

/** 把文本或思考增量追加到最后一个同类型块；没有同类型块时新建。 */
export function appendDelta(turn: SessionTurn, text: string, thinking: boolean): SessionTurn {
  if (text === "") return turn
  const kind = thinking ? "thinking" : "text"
  const last = turn.blocks[turn.blocks.length - 1]
  if (last?.type === kind) {
    const blocks = [...turn.blocks]
    blocks[blocks.length - 1] = { type: kind, text: last.text + text }
    return { ...turn, blocks }
  }
  return { ...turn, blocks: [...turn.blocks, { type: kind, text }] }
}

/** 合并一条完整 assistant 消息；重复 messageId 直接忽略，工具调用按 id 合并。 */
export function appendMessage(
  turn: SessionTurn,
  message: Extract<SessionHostEvent, { type: "message" }>,
): SessionTurn {
  if (turn.seenMessageIds.includes(message.messageId)) return turn
  let next: SessionTurn = {
    ...turn,
    seenMessageIds: [...turn.seenMessageIds, message.messageId],
  }
  for (const block of message.blocks) {
    if (block.type === "tool-use") {
      next = upsertTool(next, block.id, block.name, block.input)
    } else {
      next = mergeFullText(next, block.type, block.text)
    }
  }
  return next
}

function mergeFullText(turn: SessionTurn, kind: "text" | "thinking", text: string): SessionTurn {
  if (text === "") return turn
  const index = findLastBlock(turn.blocks, kind)
  if (index === -1) {
    return { ...turn, blocks: [...turn.blocks, { type: kind, text }] }
  }
  const current = turn.blocks[index]
  if (current?.type !== kind) return turn
  const merged = mergeText(current.text, text)
  if (merged === current.text) return turn
  const blocks = [...turn.blocks]
  blocks[index] = { type: kind, text: merged }
  return { ...turn, blocks }
}

// 流式增量已经到达时，完整消息只补齐缺失的后缀，避免界面重复。
function mergeText(streamed: string, full: string): string {
  if (streamed === "") return full
  if (full === "" || streamed.endsWith(full) || streamed.startsWith(full)) return streamed
  if (full.startsWith(streamed)) return full
  return `${streamed}${full}`
}

function findLastBlock(blocks: SessionBlock[], kind: "text" | "thinking"): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index]?.type === kind) return index
  }
  return -1
}

function upsertTool(turn: SessionTurn, id: string, name: string, input: unknown): SessionTurn {
  const existing = turn.tools.find((tool) => tool.id === id)
  if (existing === undefined) {
    return {
      ...turn,
      tools: [...turn.tools, { id, name, input, status: "running", output: null }],
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
