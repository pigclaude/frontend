// 提供会话宿主回放测试用的 SDK 消息夹具和装配：读出录制的消息，把真实适配器接到假 SDK query 上。
// 夹具只保留回放需要的消息（去掉流式增量、思考 token 计数和请求状态）。

import { readFileSync } from "node:fs"
import type { CanUseTool, SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import { FakeQuery } from "./claude-agent-adapter-fixtures"
import { createHarness, type SessionHarness } from "./session-host-fixtures"
import type { SessionHostEvent, SessionPermissionMode } from "./session-types"

/** 可以回放的夹具；名字末尾是录制它的 Claude Code 版本，回放结果只对这个版本的消息格式成立。 */
export type SdkFixture =
  | "ask-plan-2.1.310"
  | "background-agent-2.1.310"
  | "background-interrupt-2.1.310"
  | "subagent-text-2.1.310"
  | "context-flags-2.1.310"
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

/** 读出 context-flags 夹具第一轮之后录到的 getContextUsage（summary）原始回复。 */
export function loadContextReply(): unknown {
  const url = new URL("./fixtures/context-usage-summary-2.1.310.json", import.meta.url)
  return JSON.parse(readFileSync(url, "utf8"))
}

/** 接上假 SDK query 的会话宿主和已经启动的会话；canUseTool 是适配器交给 SDK 的那一个。 */
export type ReplayHarness = SessionHarness & {
  query: FakeQuery
  sessionId: string
  canUseTool: CanUseTool
}

/** 启动一个会话：适配器是真实的 ClaudeAgentAdapter，SDK query 是可以手动推送消息的假实现。 */
export async function startReplay(
  workspace: string,
  permissionMode: SessionPermissionMode = "default",
): Promise<ReplayHarness> {
  const query = new FakeQuery()
  let canUseTool: CanUseTool | undefined
  const harness = createHarness({
    workspace,
    createAdapter: (onEvent) =>
      new ClaudeAgentAdapter({
        onEvent,
        queryFn: ({ options }) => {
          canUseTool = options.canUseTool
          return query
        },
      }),
  })
  const { sessionId } = await harness.host.start({ workspace, permissionMode })
  if (canUseTool === undefined) throw new Error("canUseTool was not passed to the SDK")
  return { ...harness, query, sessionId, canUseTool }
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
