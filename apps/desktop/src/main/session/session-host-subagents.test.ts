// 负责用录制的 SDK 消息回放验证子代理归属：子代理的消息、工具结果和权限询问带上父工具调用 id 和
// agent id，主线程的归属为 null；认不出父工具调用的子代理权限仍归子代理。子代理在收到任务通知时
// 才发出结束事件。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { afterEach, describe, expect, it } from "vitest"
import type { PermissionRequestEvent } from "./permission-broker"
import { waitUntil } from "./session-host-fixtures"
import { loadSdkFixture, replay, startReplay, type ReplayHarness } from "./session-replay-fixtures"

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

    const owned = harness.events.flatMap((event) =>
      event.type === "message" || event.type === "tool-result"
        ? [[event.type, event.subagent]]
        : [],
    )
    const subagent = { parentToolUseId: agentCall, agentId }
    expect(owned).toEqual([
      ["message", null],
      ["tool-result", null],
      ["message", null],
      ["message", subagent],
      ["message", subagent],
      ["tool-result", subagent],
      ["message", subagent],
      ["message", null],
      ["message", null],
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
      (event) => event.type === "message" && event.subagent?.parentToolUseId === agentCall,
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
      event.type === "message" && event.subagent?.parentToolUseId === call
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
    await replayUntilSubagentWorks(harness)

    const permissions = await ask(harness, [agentId, undefined])

    expect(permissions.map((event) => event.subagent)).toEqual([
      { parentToolUseId: agentCall, agentId },
      null,
    ])
    await harness.host.dispose()
  })

  it("finds a subagent's parent tool call from its messages when the task start is missing", async () => {
    const harness = await startReplay(await workspaceDir())
    await replayUntilSubagentWorks(
      harness,
      (message) => !(message.type === "system" && message.subtype === "task_started"),
    )

    const permissions = await ask(harness, [agentId])

    expect(permissions[0]?.subagent).toEqual({ parentToolUseId: agentCall, agentId })
    await harness.host.dispose()
  })

  it("keeps a permission from an unknown agent id on the subagent side", async () => {
    const harness = await startReplay(await workspaceDir())
    await replayUntilSubagentWorks(harness)

    const permissions = await ask(harness, ["agent-not-seen"])

    expect(permissions[0]?.subagent).toEqual({ parentToolUseId: null, agentId: "agent-not-seen" })
    await harness.host.dispose()
  })
})

async function replayUntilSubagentWorks(
  harness: ReplayHarness,
  keep: (message: SDKMessage) => boolean = () => true,
): Promise<void> {
  const messages = loadSdkFixture("background-agent-2.1.310")
  const subagentTool = messages.findIndex(
    (message) => message.type === "assistant" && message.parent_tool_use_id === agentCall,
  )
  await harness.host.send(harness.sessionId, { text: "start a background subagent" })
  replay(harness.query, messages.slice(0, subagentTool + 2).filter(keep))
  await waitUntil(() =>
    harness.events.some((event) => event.type === "message" && event.subagent !== null),
  )
}

async function ask(
  harness: ReplayHarness,
  agents: Array<string | undefined>,
): Promise<PermissionRequestEvent[]> {
  const signal = new AbortController().signal
  for (const [index, agent] of agents.entries()) {
    void harness.canUseTool(
      "Bash",
      { command: "ls" },
      {
        signal,
        toolUseID: `tool-${index}`,
        requestId: `control-${index}`,
        ...(agent === undefined ? {} : { agentID: agent }),
      },
    )
  }
  await waitUntil(
    () => harness.events.filter((event) => event.type === "permission").length === agents.length,
  )
  return harness.events.filter((event) => event.type === "permission")
}

async function workspaceDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pigclaude-subagents-"))
  temporaryDirs.push(dir)
  return dir
}
