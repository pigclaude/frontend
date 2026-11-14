// 验证聊天页改动思考深度和快速模式后，当前会话的下一条消息带上新值，发送失败时输入框恢复草稿。

// @vitest-environment jsdom
import { act } from "react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { createSessionState, reduceSession } from "../models/session-model"
import {
  chatScreenRoot,
  clickButton,
  sessionController,
  typeAndSend,
} from "../test-support/chat-screen-harness"

const screen = chatScreenRoot()
const live = reduceSession(createSessionState(), { type: "opened", sessionId: "session-1" })
const models = [
  {
    id: "claude-opus",
    displayName: "Opus",
    description: "",
    isDefault: true,
    efforts: ["low", "medium", "high"],
    fast: true,
  },
]

describe("chat screen turn settings", () => {
  it("uses the new effort and fast preference for the next message and can reset both", async () => {
    const session = sessionController({ state: live, models })
    await screen.render({ fresh: false, session })
    const user = userEvent.setup()

    await chooseSettings(user, "{End}", true)
    await typeAndSend(screen.container, "认真想")
    expect(session.send).toHaveBeenLastCalledWith("认真想", { effort: "high", fast: true })

    await chooseSettings(user, "{Home}", false)
    await typeAndSend(screen.container, "恢复默认")
    expect(session.send).toHaveBeenLastCalledWith("恢复默认", { effort: null, fast: false })
    expect(session.start).not.toHaveBeenCalled()
  })

  it("restores the message when the current session cannot apply its settings", async () => {
    const send = vi.fn(async () => false)
    const session = sessionController({ state: live, models, send })
    await screen.render({ fresh: false, session })
    await chooseSettings(userEvent.setup(), "{End}", true)

    await typeAndSend(screen.container, "请重试")

    expect(send).toHaveBeenCalledWith("请重试", { effort: "high", fast: true })
    expect(screen.container.querySelector(".composer .tiptap")?.textContent).toBe("请重试")
  })
})

async function chooseSettings(
  user: ReturnType<typeof userEvent.setup>,
  key: string,
  fast: boolean,
): Promise<void> {
  await clickButton(
    screen.container.querySelector<HTMLElement>(".model-chip") ?? undefined,
    "模型选择器",
  )
  const slider = await vi.waitFor(() => {
    const element = document.querySelector<HTMLElement>('.model-effort input[type="range"]')
    if (element === null) throw new Error("找不到思考深度滑块")
    return element
  })
  await act(async () => {
    slider.focus()
    await user.keyboard(key)
  })
  const toggle = document.querySelector<HTMLButtonElement>('button[aria-label="快速模式"]')
  expect(toggle?.disabled).toBe(false)
  if (toggle?.getAttribute("aria-pressed") !== String(fast))
    await clickButton(toggle ?? undefined, "快速模式")
  await act(async () => user.keyboard("{Escape}"))
}
