// 负责用录制的 SDK 消息回放验证工作流快照：主线程调用 Workflow 时先发一份运行中的快照，任务开始、
// 进度和通知消息更新阶段与各个 agent，只在看得见的内容变化时发出；Workflow 工具报错时工作流失败；
// 停止这一轮时工作流按任务通知显示为已停止。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import type { WorkflowSnapshot } from "@pigclaude/ui-contracts"
import { afterEach, describe, expect, it } from "vitest"
import { waitUntil } from "./session-host-fixtures"
import {
  loadSdkFixture,
  replay,
  startReplay,
  turnBoundaries,
  type ReplayHarness,
} from "./session-replay-fixtures"
import type { SessionHostEvent } from "./session-types"

const temporaryDirs: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function snapshots(events: readonly SessionHostEvent[]): WorkflowSnapshot[] {
  return events.flatMap((event) => (event.type === "workflow" ? [event.workflow] : []))
}

function agentStates(snapshot: WorkflowSnapshot): string[] {
  return snapshot.agents.map((agent) => `${agent.label}:${agent.state}`)
}

async function replayed(messages: readonly SDKMessage[]): Promise<ReplayHarness> {
  const harness = await startReplay(await workspaceDir())
  await harness.host.send(harness.sessionId, { text: "run a workflow" })
  replay(harness.query, messages)
  return harness
}

describe("SessionHost workflows", () => {
  it("snapshots the 2.1.310 workflow from its call, task progress and notification", async () => {
    const harness = await replayed(loadSdkFixture("workflow-2.1.310"))
    await waitUntil(() => harness.events.some((event) => event.type === "turn-ended"))

    const all = snapshots(harness.events)
    expect(all.map((snapshot) => [snapshot.status, ...agentStates(snapshot)])).toEqual([
      ["running"],
      ["running"],
      ["running", "count-lines:running", "list-files:running"],
      ["running", "count-lines:done", "list-files:running"],
      ["running", "count-lines:done", "list-files:done"],
      ["completed", "count-lines:done", "list-files:done"],
    ])
    expect(all[0]).toMatchObject({
      toolCallId: "call_00_h5jycxk2mphvomn9oq5r6f51",
      name: "count-and-list",
      description: "Count lines in notes.txt and list files in the current directory",
      phases: [],
    })
    expect(all[0]?.script).toContain("phase('Inspect')")
    expect(all.slice(1).every((snapshot) => snapshot.script === undefined)).toBe(true)
    expect(all[1]?.phases).toEqual([{ index: 1, title: "Inspect" }])
    expect(all[3]?.agents[0]).toMatchObject({ phase: "Inspect", result: '{"lines":3}' })
    expect(all[3]?.agents[1]).toMatchObject({ activity: "Bash ls -1A <tmp>" })
    expect(all.at(-1)).toMatchObject({
      taskId: "wfexjadjq",
      summary:
        'Dynamic workflow "Count lines in notes.txt and list files in the current directory" completed',
      usage: { tokens: 26_860, toolCalls: 5, durationMs: 24_182 },
    })
    await harness.host.dispose()
  })

  it("snapshots the 2.1.304 workflow recorded by Pigcode", async () => {
    const harness = await replayed(loadSdkFixture("workflow-2.1.304"))
    await waitUntil(() => harness.events.some((event) => event.type === "turn-ended"))

    const all = snapshots(harness.events)
    expect(all[0]).toMatchObject({
      toolCallId: "toolu_01AYfEP7d59gsMp5nvwsqkCV",
      name: "review-two-files",
      description: "One agent per file (math.js, greet.js) writes a one-sentence review",
      status: "running",
      agents: [],
    })
    expect(all.length).toBeGreaterThan(3)
    expect(all.length).toBeLessThan(12)
    const running = all.find((snapshot) =>
      snapshot.agents.some((agent) => agent.state === "running" && agent.activity),
    )
    expect(running?.phases).toEqual([{ index: 1, title: "Review" }])
    expect(running?.agents.map((agent) => agent.label)).toEqual([
      "review:math.js",
      "review:greet.js",
    ])
    expect(running?.agents[0]?.activity).toMatch(/^Read /)
    const last = all.at(-1)
    expect(last).toMatchObject({
      status: "completed",
      taskId: "wtuye9udr",
      usage: { tokens: 64_398, toolCalls: 2, durationMs: 20_986 },
    })
    expect(last && agentStates(last)).toEqual(["review:math.js:done", "review:greet.js:done"])
    expect(last?.agents[1]?.result).toContain("greet")
    await harness.host.dispose()
  })

  it("publishes the first snapshot right after the message that calls the workflow", async () => {
    const harness = await replayed(loadSdkFixture("workflow-2.1.310"))
    await waitUntil(() => harness.events.some((event) => event.type === "turn-ended"))

    const first = harness.events.findIndex((event) => event.type === "workflow")
    expect(harness.events[first - 1]).toMatchObject({
      type: "message",
      blocks: [{ type: "tool-use", id: "call_00_h5jycxk2mphvomn9oq5r6f51", name: "Workflow" }],
    })
    await harness.host.dispose()
  })

  it("fails the workflow with the tool's message when the Workflow tool errors", async () => {
    const messages = loadSdkFixture("workflow-2.1.310")
    const call = messages.findIndex((message) => isWorkflowCall(message))
    const init = messages[0]
    const callMessage = messages[call]
    if (init === undefined || callMessage === undefined) throw new Error("fixture changed")
    const harness = await replayed([
      init,
      callMessage,
      toolError("call_00_h5jycxk2mphvomn9oq5r6f51", "Workflows are disabled"),
    ])
    await waitUntil(() => snapshots(harness.events).length === 2)

    expect(snapshots(harness.events).at(-1)).toMatchObject({
      status: "failed",
      summary: "Workflows are disabled",
    })
    await harness.host.dispose()
  })

  it("shows the workflow as stopped when the user stops the turn", async () => {
    const messages = loadSdkFixture("workflow-2.1.310")
    const firstResult = messages.findIndex((message) => message.type === "result")
    const harness = await replayed(messages.slice(0, firstResult + 1))
    await waitUntil(() => harness.events.some((event) => event.type === "result"))
    harness.query.afterInterrupt = () => replay(harness.query, stoppedByInterrupt(messages))

    await harness.host.cancel(harness.sessionId)
    await waitUntil(() => snapshots(harness.events).at(-1)?.status !== "running")

    const last = snapshots(harness.events).at(-1)
    expect(last?.status).toBe("stopped")
    expect(last && agentStates(last)).toEqual(["count-lines:running", "list-files:running"])
    expect(turnBoundaries(harness.events)).toEqual([
      "turn-started",
      "result",
      "turn-ended:interrupted",
    ])
    await harness.host.dispose()
  })
})

function isWorkflowCall(message: SDKMessage): boolean {
  if (message.type !== "assistant") return false
  return message.message.content.some(
    (block) => block.type === "tool_use" && block.name === "Workflow",
  )
}

function toolError(toolUseId: string, content: string): SDKMessage {
  return {
    type: "user",
    parent_tool_use_id: null,
    session_id: "session",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, is_error: true, content }],
    },
  } as SDKMessage
}

// 录制里没有停掉工作流的样本：按后台子代理被中断时的消息顺序，把录制的任务通知改成 stopped。
function stoppedByInterrupt(messages: readonly SDKMessage[]): SDKMessage[] {
  const tail = messages.filter(
    (message) =>
      message.type === "system" &&
      (message.subtype === "task_notification" || message.subtype === "background_tasks_changed"),
  )
  return tail
    .slice(-2)
    .map((message) =>
      message.type === "system" && message.subtype === "task_notification"
        ? { ...message, status: "stopped" as const, summary: "Dynamic workflow stopped" }
        : message,
    )
}

async function workspaceDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pigclaude-session-workflows-"))
  temporaryDirs.push(dir)
  return dir
}
