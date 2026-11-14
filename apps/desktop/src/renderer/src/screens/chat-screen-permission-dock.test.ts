// 负责验证聊天页的权限卡片位置：会话在还没有任何一轮时就已开始（从草稿发出第一条消息），
// 第一轮出现后权限卡片照样挂在输入框上方。

// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { createSessionState, reduceSession, type SessionUiState } from "../models/session-model"
import {
  chatScreenRoot,
  sessionController as controller,
  sessionTime,
} from "../test-support/chat-screen-harness"
import { receive } from "../test-support/session-envelopes"

const screen = chatScreenRoot()

async function show(state: SessionUiState): Promise<void> {
  await screen.render({ fresh: true, session: controller({ state }) })
}

describe("chat screen permission dock", () => {
  it("docks a permission above the composer once the first turn of a just-opened session shows", async () => {
    let state = reduceSession(createSessionState(), { type: "starting" })
    state = reduceSession(state, { type: "opened", sessionId: "session-1" })
    await show(state)
    state = reduceSession(state, {
      type: "user-message",
      text: "看看测试",
      turnId: "turn-1",
      at: sessionTime,
    })
    await show(state)
    state = receive(state, { type: "turn-started", turnId: "main-1" }, sessionTime)
    state = receive(
      state,
      { type: "permission", requestId: "p-1", toolName: "Bash", input: { command: "ls" } },
      sessionTime,
    )
    await show(state)

    const prompt = screen.container.querySelector(".perm-prompt")
    expect(prompt, "权限卡片").not.toBeNull()
    expect(prompt?.closest(".composer-wrap")).not.toBeNull()
  })
})
