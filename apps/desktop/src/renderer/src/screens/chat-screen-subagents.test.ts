// 负责验证聊天页的子代理：子代理的消息和工具调用不进主时间线，子代理卡显示任务、运行中最近一次工具
// 调用和交回的结果；点开卡片后线程头出现子代理标签，显示它的只读过程；子代理等待权限回答时标签显示
// 等待；标签的选中和关闭只记在渲染层内存里。

// @vitest-environment jsdom
import { createElement } from "react"
import { describe, expect, it } from "vitest"
import type { SessionHostEvent } from "../../../main/session/session-types"
import type { SessionUiState } from "../models/session-model"
import {
  buttonNamed,
  chatScreenRoot,
  clickButton,
  sessionController as controller,
  sessionTime,
  startingState,
} from "../test-support/chat-screen-harness"
import { receive } from "../test-support/session-envelopes"

const screen = chatScreenRoot()
const call = "call-agent"

function message(
  messageId: string,
  blocks: Extract<SessionHostEvent, { type: "message" }>["blocks"],
  parentToolUseId: string | null = null,
): SessionHostEvent {
  return {
    type: "message",
    messageId,
    model: "claude-sonnet",
    parentToolUseId,
    ...(parentToolUseId === null ? {} : { agentId: "agent-1" }),
    blocks,
  }
}

const working: SessionHostEvent[] = [
  { type: "turn-started", turnId: "main-turn-1" },
  message("m-1", [
    {
      type: "tool-use",
      id: call,
      name: "Agent",
      input: { subagent_type: "general-purpose", description: "跑命令", prompt: "运行 sleep" },
    },
  ]),
  {
    type: "tool-result",
    toolUseId: call,
    content: "Async agent launched successfully.",
    isError: false,
  },
  message("m-2", [{ type: "text", text: "子代理已在后台启动" }]),
  message("s-1", [{ type: "text", text: "我先跑一下命令" }], call),
  message(
    "s-1",
    [{ type: "tool-use", id: "bash-1", name: "Bash", input: { command: "sleep 21" } }],
    call,
  ),
]

const finished: SessionHostEvent = {
  type: "subagent-ended",
  parentToolUseId: call,
  agentId: "agent-1",
  status: "completed",
  summary: "命令输出 SUB_DONE",
}

function feed(state: SessionUiState, ...events: SessionHostEvent[]): SessionUiState {
  return events.reduce((current, event) => receive(current, event, sessionTime), state)
}

function tabNames(): string[] {
  return [...screen.container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent ?? "")
}

function agentRow(): HTMLElement | null {
  return screen.container.querySelector<HTMLElement>(".subagent-row")
}

function labelled(label: string): HTMLElement | undefined {
  return screen.container.querySelector<HTMLElement>(`[aria-label="${label}"]`) ?? undefined
}

async function openCard(): Promise<void> {
  await clickButton(labelled("在标签页中打开 general-purpose"), "在标签页中打开")
}

describe("chat screen subagents", () => {
  it("keeps the subagent's work off the main timeline and shows its latest tool call on the card", async () => {
    await screen.render({
      fresh: false,
      session: controller({ state: feed(startingState(), ...working) }),
    })

    expect(screen.container.textContent).not.toContain("我先跑一下命令")
    expect(
      screen.container.querySelectorAll(".turn-work .tool-row:not(.subagent-row)"),
    ).toHaveLength(0)
    expect(agentRow()?.textContent).toContain("sleep 21")
    expect(agentRow()?.dataset.status).toBe("running")
  })

  it("opens a tab with the subagent's read-only process from its card and goes back", async () => {
    await screen.render({
      fresh: false,
      session: controller({ state: feed(startingState(), ...working) }),
    })

    await openCard()

    expect(tabNames()).toEqual([expect.any(String), expect.stringContaining("跑命令")])
    const view = screen.container.querySelector(".subagent-view")
    expect(view?.textContent).toContain("运行 sleep")
    expect(view?.textContent).toContain("我先跑一下命令")
    expect(view?.textContent).toContain("sleep 21")
    expect(screen.container.textContent).toContain("主 agent 派生的子代理，只读")

    await clickButton(buttonNamed("回到主会话"), "回到主会话")
    expect(screen.container.querySelector(".subagent-view")).toBeNull()
    expect(screen.container.textContent).toContain("子代理已在后台启动")
  })

  it("shows the subagent as done with its result only after it ends", async () => {
    const state = feed(startingState(), ...working, finished)
    await screen.render({ fresh: false, session: controller({ state }) })

    expect(agentRow()?.dataset.status).toBe("completed")
    await openCard()
    expect(screen.container.querySelector(".subagent-view-result")?.textContent).toContain(
      "命令输出 SUB_DONE",
    )
  })

  it("marks the subagent's tab as waiting while its permission is pending", async () => {
    const state = feed(startingState(), ...working, {
      type: "permission",
      requestId: "p-1",
      toolName: "Bash",
      input: { command: "rm -rf build" },
      parentToolUseId: call,
      agentId: "agent-1",
    })
    await screen.render({ fresh: false, session: controller({ state }) })

    const tab = screen.container.querySelector('[data-tab-id="spawned:call-agent"]')
    expect(tab, "子代理标签").not.toBeNull()
    expect(tab?.querySelector('[aria-label="等待许可"]') ?? null).not.toBeNull()
  })

  it("keeps a closed tab closed and the chosen tab across remounts", async () => {
    const session = controller({ state: feed(startingState(), ...working) })
    await screen.render({ fresh: false, session })
    await openCard()
    await screen.renderElement(createElement("div"))
    await screen.render({ fresh: false, session })
    expect(screen.container.querySelector(".subagent-view")).not.toBeNull()

    await clickButton(labelled("关闭 跑命令"), "关闭")
    expect(tabNames()).toHaveLength(1)
    expect(screen.container.querySelector(".subagent-view")).toBeNull()
  })
})
