// 负责用录制的 SDK 消息回放验证子代理归属：子代理的消息、工具结果和权限询问带上父工具调用 id 和
// agent id，子代理在收到任务通知时才发出结束事件。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { waitUntil } from "./session-host-fixtures"
import { loadSdkFixture, replay, startReplay } from "./session-replay-fixtures"

const temporaryDirs: string[] = []
const agentCall = "call_00_u5yk0fbs6v00oj3p3cd57eqe"
const agentId = "a74b36fd6cc2efc90"

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("SessionHost subagents", () => {
  it("marks the subagent's messages and tool results with its parent tool call and agent id", async () => {
    const harness = await startReplay(await workspaceDir())

    await harness.host.send(harness.sessionId, { text: "start a background subagent" })
    replay(harness.query, loadSdkFixture("background-agent-2.1.310"))
    await waitUntil(() => harness.events.some((event) => event.type === "turn-ended"))

    const owned = harness.events.flatMap((event) => {
      if (event.type === "message") {
        return [[event.type, event.parentToolUseId, event.agentId ?? null]]
      }
      if (event.type === "tool-result") {
        return [[event.type, event.parentToolUseId ?? null, event.agentId ?? null]]
      }
      return []
    })
    expect(owned).toEqual([
      ["message", null, null],
      ["tool-result", null, null],
      ["message", null, null],
      ["message", agentCall, agentId],
      ["message", agentCall, agentId],
      ["tool-result", agentCall, agentId],
      ["message", agentCall, agentId],
      ["message", null, null],
      ["message", null, null],
    ])
    await harness.host.dispose()
  })

  it("ends a background subagent on its task notification, not on the launch result", async () => {
    const harness = await startReplay(await workspaceDir())

    await harness.host.send(harness.sessionId, { text: "start a background subagent" })
    replay(harness.query, loadSdkFixture("background-agent-2.1.310"))
    await waitUntil(() => harness.events.some((event) => event.type === "turn-ended"))

    const launched = harness.events.findIndex(
      (event) => event.type === "tool-result" && event.toolUseId === agentCall,
    )
    const lastSubagentMessage = harness.events.findLastIndex(
      (event) => event.type === "message" && event.parentToolUseId === agentCall,
    )
    const ended = harness.events.flatMap((event, index) =>
      event.type === "subagent-ended" ? [{ index, event }] : [],
    )
    expect(ended).toHaveLength(1)
    expect(ended[0]?.index).toBeGreaterThan(launched)
    expect(ended[0]?.index).toBeGreaterThan(lastSubagentMessage)
    expect(ended[0]?.event).toMatchObject({
      type: "subagent-ended",
      parentToolUseId: agentCall,
      agentId,
      status: "completed",
    })
    expect(ended[0]?.event.summary).toContain("SUB_DONE")
    await harness.host.dispose()
  })

  it("forwards a foreground subagent's text and ends it before its hand-back result", async () => {
    const harness = await startReplay(await workspaceDir())
    const call = "call_00_1nv3faluwu5pzpajs390n5xi"

    await harness.host.send(harness.sessionId, { text: "start a foreground subagent" })
    replay(harness.query, loadSdkFixture("subagent-text-2.1.310"))
    await waitUntil(() => harness.events.some((event) => event.type === "turn-ended"))

    const blocks = harness.events.flatMap((event) =>
      event.type === "message" && event.parentToolUseId === call
        ? event.blocks.map((block) => block.type)
        : [],
    )
    expect(blocks).toEqual(["tool-use", "thinking", "text"])
    const ended = harness.events.findIndex((event) => event.type === "subagent-ended")
    const handBack = harness.events.findIndex(
      (event) => event.type === "tool-result" && event.toolUseId === call,
    )
    expect(harness.events[ended]).toMatchObject({
      parentToolUseId: call,
      agentId: "a2396883bc1390f40",
      status: "completed",
    })
    expect(ended).toBeLessThan(handBack)
    await harness.host.dispose()
  })

  it("ends an interrupted background subagent as stopped", async () => {
    const harness = await startReplay(await workspaceDir())

    await harness.host.send(harness.sessionId, { text: "start a background subagent" })
    replay(harness.query, loadSdkFixture("background-interrupt-2.1.310"))
    await waitUntil(() => harness.events.some((event) => event.type === "subagent-ended"))

    expect(harness.events.filter((event) => event.type === "subagent-ended")).toMatchObject([
      { parentToolUseId: "call_00_zxffce1g361j3hiiieswrslj", status: "stopped" },
    ])
    await harness.host.dispose()
  })

  it("asks a subagent's permission with its parent tool call and agent id", async () => {
    const harness = await startReplay(await workspaceDir())
    const messages = loadSdkFixture("background-agent-2.1.310")
    const subagentTool = messages.findIndex(
      (message) => message.type === "assistant" && message.parent_tool_use_id === agentCall,
    )

    await harness.host.send(harness.sessionId, { text: "start a background subagent" })
    replay(harness.query, messages.slice(0, subagentTool + 2))
    await waitUntil(() =>
      harness.events.some((event) => event.type === "message" && event.parentToolUseId !== null),
    )
    const signal = new AbortController().signal
    void harness.canUseTool(
      "Bash",
      { command: "sleep 21" },
      {
        signal,
        toolUseID: "call_00_ckmv3ue7pazeijtlxw6l9ipx",
        agentID: agentId,
      },
    )
    void harness.canUseTool("Bash", { command: "ls" }, { signal, toolUseID: "main-tool" })
    await waitUntil(
      () => harness.events.filter((event) => event.type === "permission").length === 2,
    )

    const permissions = harness.events.filter((event) => event.type === "permission")
    expect(permissions[0]).toMatchObject({ parentToolUseId: agentCall, agentId })
    expect(permissions[1]).not.toHaveProperty("parentToolUseId")
    expect(permissions[1]).not.toHaveProperty("agentId")
    await harness.host.dispose()
  })
})

async function workspaceDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pigclaude-subagents-"))
  temporaryDirs.push(dir)
  return dir
}
