// 负责验证聊天页输入框的上下文占用圆环：会话报来占用后显示已用、上限和自动压缩线，
// 还没有数据时不显示；换号后保留旧值直到新值到来。

// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import type { SessionHostEvent } from "../../../main/session/session-types"
import type { SessionUiState } from "../models/session-model"
import {
  chatScreenRoot,
  sessionController as controller,
  sessionTime,
  startingState,
} from "../test-support/chat-screen-harness"
import { receive } from "../test-support/session-envelopes"

const screen = chatScreenRoot()

const answered: SessionHostEvent[] = [
  { type: "turn-started", turnId: "main-turn-1" },
  {
    type: "message",
    messageId: "m-1",
    model: "claude-sonnet",
    subagent: null,
    blocks: [{ type: "text", text: "改好了。" }],
  },
  { type: "turn-ended", turnId: "main-turn-1", status: "completed", errorCode: null },
]

const usage: SessionHostEvent = {
  type: "context",
  usedTokens: 35_002,
  maxTokens: 200_000,
  autoCompactTokens: 167_000,
}

function feed(state: SessionUiState, ...events: SessionHostEvent[]): SessionUiState {
  return events.reduce((current, event) => receive(current, event, sessionTime), state)
}

function meter(): string | null {
  return (
    screen.container.querySelector(".composer .context-meter")?.getAttribute("aria-label") ?? null
  )
}

describe("chat screen context usage", () => {
  it("shows the used tokens, the window and the auto-compact line in the composer ring", async () => {
    await screen.render({
      fresh: false,
      session: controller({ state: feed(startingState(), ...answered, usage) }),
    })

    expect(meter()).toBe("上下文，已用 35k / 200k（18%），到 167k 自动压缩，还剩 132k")
  })

  it("shows no ring before the session reports any usage", async () => {
    await screen.render({
      fresh: false,
      session: controller({ state: feed(startingState(), ...answered) }),
    })

    expect(screen.container.querySelector(".composer")).not.toBeNull()
    expect(meter()).toBeNull()
  })

  it("keeps the last usage after an account switch until the new usage arrives", async () => {
    const switched = feed(
      startingState(),
      ...answered,
      usage,
      { type: "turn-started", turnId: "main-turn-2" },
      { type: "account-switched", from: "account-a", to: "account-b", reason: "quota" },
    )
    await screen.render({ fresh: false, session: controller({ state: switched }) })

    expect(screen.container.querySelector("[role='separator']")?.textContent).toContain("备用 Pro")
    expect(meter()).toBe("上下文，已用 35k / 200k（18%），到 167k 自动压缩，还剩 132k")

    const refreshed = feed(switched, { ...usage, usedTokens: 40_000 })
    await screen.render({ fresh: false, session: controller({ state: refreshed }) })

    expect(meter()).toBe("上下文，已用 40k / 200k（20%），到 167k 自动压缩，还剩 127k")
  })
})
