// 负责决定工作台什么时候重读项目：Claude 的工具调用结束或一轮结束后，文件树、Git 状态、Diff 和打开的文件都重读。
import { sessionRecord } from "./session-event-store"
import type { SessionUiState } from "./session-model"

/**
 * 可能改动过项目的事件数：当前会话里结束的工具调用（同一调用只算一次）加上结束的轮次。
 * 同一会话里只增不减，可以直接作为工作台的版本号。
 */
export function workspaceRevision(
  state: Pick<SessionUiState, "events" | "sessionId" | "turns">,
): number {
  const finished = new Set<string>()
  for (const { event } of sessionRecord(state.events, state.sessionId).envelopes) {
    if (event.type === "tool-result") finished.add(event.toolUseId)
  }
  return finished.size + state.turns.filter((turn) => turn.endedAt !== null).length
}
