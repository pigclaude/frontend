// 负责验证工作台什么时候重读项目：每个工具调用结束、每轮结束都让版本号前进，进行中的不算。
import { describe, expect, it } from "vitest"
import type { SessionToolCall, SessionTurn } from "./session-model"
import { workspaceRevision } from "./workspace-revision"

function tool(status: SessionToolCall["status"]): SessionToolCall {
  const endedAt = status === "running" ? null : "2026-11-14T00:00:01.000Z"
  return {
    id: crypto.randomUUID(),
    name: "Edit",
    input: {},
    status,
    output: null,
    startedAt: "2026-11-14T00:00:00.000Z",
    endedAt,
  }
}

function turn(tools: SessionToolCall[], finished: boolean): SessionTurn {
  return {
    id: crypto.randomUUID(),
    startedAt: "2026-11-14T00:00:00.000Z",
    endedAt: finished ? "2026-11-14T00:00:02.000Z" : null,
    userText: "go",
    blocks: [],
    tools,
    permissions: [],
    switches: [],
    errors: [],
    result: finished
      ? {
          subtype: "success",
          isError: false,
          durationMs: 1,
          numTurns: 1,
          stopReason: null,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        }
      : null,
    status: finished ? "done" : "streaming",
    seenMessageIds: [],
  }
}

describe("workspaceRevision", () => {
  it("moves forward when a tool call finishes during a turn and when the turn ends", () => {
    expect(workspaceRevision([])).toBe(0)
    expect(workspaceRevision([turn([tool("running")], false)])).toBe(0)
    expect(workspaceRevision([turn([tool("done"), tool("running")], false)])).toBe(1)
    expect(workspaceRevision([turn([tool("done"), tool("error")], false)])).toBe(2)
    expect(workspaceRevision([turn([tool("done"), tool("error")], true)])).toBe(3)
    expect(
      workspaceRevision([turn([tool("done")], true), turn([tool("done"), tool("running")], false)]),
    ).toBe(3)
  })
})
