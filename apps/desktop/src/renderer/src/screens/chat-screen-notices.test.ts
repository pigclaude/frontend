// 验证带语言键的会话提示显示在对应回合，旧的会话通知仍留在原来的通知入口。

// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import {
  chatScreenRoot,
  sessionController,
  sessionTime,
  startingState,
} from "../test-support/chat-screen-harness"
import { receive } from "../test-support/session-envelopes"

const screen = chatScreenRoot()

describe("chat screen timeline notices", () => {
  it("shows the stalled warning from the existing language pack in the current turn", async () => {
    const state = receive(
      startingState(),
      { type: "notice", key: "run.stalled", level: "warning", params: { seconds: "120" } },
      sessionTime,
    )
    await screen.render({ fresh: false, session: sessionController({ state }) })

    expect(screen.container.querySelector(".turn-notice")?.textContent ?? "").toContain(
      "已经 120 秒没有收到 Agent 的任何回应",
    )
    expect(state.notice).toBeNull()
  })

  it("recovers the restart message saved by earlier versions without opening a toast", async () => {
    const state = receive(
      startingState(),
      { type: "notice", message: "应用已重启，这一轮已中断" },
      sessionTime,
    )
    await screen.render({ fresh: false, session: sessionController({ state }) })

    expect(screen.container.querySelector(".turn-notice")?.textContent ?? "").toContain(
      "应用重启过，这一轮被中断了",
    )
    expect(state.notice).toBeNull()
  })
})
