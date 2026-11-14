// 负责验证聊天页的工作流卡：主进程发来的工作流快照画成拷入的工作流卡，阶段和各个 agent 的状态
// 随新的快照更新，Workflow 工具调用本身不画成工具行；停止这一轮后工作流显示为已停止。

// @vitest-environment jsdom
import type { WorkflowSnapshot } from "@pigclaude/ui-contracts"
import { describe, expect, it } from "vitest"
import type { SessionHostEvent } from "../../../main/session/session-types"
import { reduceSession, type SessionUiState } from "../models/session-model"
import {
  chatScreenRoot,
  sessionController as controller,
  sessionTime,
  startingState,
} from "../test-support/chat-screen-harness"
import { receive } from "../test-support/session-envelopes"

const screen = chatScreenRoot()
const call = "call-workflow"

type AgentState = WorkflowSnapshot["agents"][number]["state"]

function snapshot(status: WorkflowSnapshot["status"], states: AgentState[]): SessionHostEvent {
  return {
    type: "workflow",
    workflow: {
      toolCallId: call,
      name: "review-two-files",
      description: "每个文件派一个 agent 写一句评审",
      status,
      phases: [{ index: 1, title: "Review" }],
      agents: states.map((state, index) => ({
        index: index + 1,
        label: index === 0 ? "review:math.js" : "review:greet.js",
        phase: "Review",
        state,
        ...(state === "running" ? { activity: "Read src/math.js" } : {}),
        ...(state === "done" ? { result: "写得清楚" } : {}),
      })),
    },
  }
}

const working: SessionHostEvent[] = [
  { type: "turn-started", turnId: "main-turn-1" },
  {
    type: "message",
    messageId: "m-1",
    model: "claude-sonnet",
    subagent: null,
    blocks: [
      { type: "tool-use", id: call, name: "Workflow", input: { script: "phase('Review')" } },
    ],
  },
  {
    type: "tool-result",
    toolUseId: call,
    content: "Workflow launched in background",
    isError: false,
    subagent: null,
    backgroundLaunch: true,
  },
  snapshot("running", ["running", "queued"]),
]

function feed(state: SessionUiState, ...events: SessionHostEvent[]): SessionUiState {
  return events.reduce((current, event) => receive(current, event, sessionTime), state)
}

function card(): HTMLElement | null {
  return screen.container.querySelector<HTMLElement>(".workflow-row")
}

function agentStates(): string[] {
  return [...screen.container.querySelectorAll<HTMLElement>(".workflow-agent")].map(
    (agent) =>
      `${agent.querySelector(".workflow-agent-label")?.textContent}:${agent.dataset.state}`,
  )
}

async function show(state: SessionUiState): Promise<void> {
  await screen.render({ fresh: false, session: controller({ state }) })
}

describe("chat screen workflows", () => {
  it("draws the workflow card with its phase and each agent's state instead of a tool row", async () => {
    await show(feed(startingState(), ...working))

    expect(card()?.dataset.status).toBe("running")
    expect(card()?.textContent).toContain("工作流")
    expect(card()?.textContent).toContain("review-two-files")
    expect(card()?.textContent).toContain("Review · 0/2 完成")
    expect(agentStates()).toEqual(["review:math.js:running", "review:greet.js:queued"])
    expect(card()?.textContent).toContain("Read src/math.js")
    expect(
      screen.container.querySelectorAll(".turn-work .tool-row:not(.workflow-row)"),
    ).toHaveLength(0)
  })

  it("updates the phase and the agents as new snapshots arrive", async () => {
    const state = feed(startingState(), ...working)
    await show(state)

    await show(feed(state, snapshot("running", ["done", "running"])))

    expect(agentStates()).toEqual(["review:math.js:done", "review:greet.js:running"])
    expect(card()?.textContent).toContain("Review · 1/2 完成")
    expect(card()?.textContent).toContain("写得清楚")
  })

  it("shows the workflow as stopped after the user stops the turn", async () => {
    const running = feed(startingState(), ...working)
    const stopping = reduceSession(running, { type: "cancel-requested", at: sessionTime })

    await show(
      feed(stopping, {
        type: "turn-ended",
        turnId: "main-turn-1",
        status: "interrupted",
        errorCode: "SESSION_CANCELLED",
      }),
    )

    expect(card()?.dataset.status).toBe("stopped")
    expect(card()?.textContent).toContain("已停止")
  })
})
