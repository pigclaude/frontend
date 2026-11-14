// 提供会话宿主回放测试用的 SDK 消息夹具和装配：读出录制的消息，把真实适配器接到假 SDK query 上。
// 夹具只保留回放需要的消息（去掉流式增量、思考 token 计数和请求状态），来源见 fixtures 目录的文件名。

import { readFileSync } from "node:fs"
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import { FakeQuery } from "./claude-agent-adapter-fixtures"
import { createHarness, type SessionHarness } from "./session-host-fixtures"
import type { SessionHostEvent } from "./session-types"

/** 随包 Claude Code 2.1.310 的开发供应商录制（#72）和 Pigcode 录制的 2.1.304 工作流。 */
export type SdkFixture =
  | "background-agent-2.1.310"
  | "background-interrupt-2.1.310"
  | "workflow-2.1.310"
  | "workflow-2.1.304"

/** 读出一份夹具里的 SDK 消息，按录制顺序。 */
export function loadSdkFixture(name: SdkFixture): SDKMessage[] {
  const text = readFileSync(new URL(`./fixtures/${name}.jsonl`, import.meta.url), "utf8")
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as SDKMessage)
}

/** 接上假 SDK query 的会话宿主和已经启动的会话。 */
export type ReplayHarness = SessionHarness & { query: FakeQuery; sessionId: string }

/** 启动一个会话：适配器是真实的 ClaudeAgentAdapter，SDK query 是可以手动推送消息的假实现。 */
export async function startReplay(workspace: string): Promise<ReplayHarness> {
  const query = new FakeQuery()
  const harness = createHarness({
    workspace,
    createAdapter: (onEvent) => new ClaudeAgentAdapter({ onEvent, queryFn: () => query }),
  })
  const { sessionId } = await harness.host.start({ workspace, permissionMode: "default" })
  return { ...harness, query, sessionId }
}

/** 把消息按顺序交给假 query。 */
export function replay(query: FakeQuery, messages: readonly SDKMessage[]): void {
  for (const message of messages) query.emit(message)
}

/** 只留下回合开闭和 result，便于断言一轮的边界。 */
export function turnBoundaries(events: readonly SessionHostEvent[]): string[] {
  return events.flatMap((event) => {
    if (event.type === "turn-ended") return [`turn-ended:${event.status}`]
    return event.type === "turn-started" || event.type === "result" ? [event.type] : []
  })
}
