// 负责验证聊天页：空状态、开始会话、流式文本、工具折叠、权限卡片、换号提示、取消/停止和错误提示，且页面不出现凭据。

// @vitest-environment jsdom
import { act, createElement, useState } from "react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { receive } from "../test-support/session-envelopes"
import { createSessionState, reduceSession } from "../models/session-model"
import {
  buttonNamed,
  chatAccount,
  chatScreenElement,
  chatScreenRoot,
  clickButton,
  sessionController as controller,
  sessionTime,
  startingState,
  typeAndSend,
} from "../test-support/chat-screen-harness"

const screen = chatScreenRoot()

function buttonStartingWith(prefix: string): HTMLElement | undefined {
  return [...screen.container.querySelectorAll<HTMLElement>('button, [role="button"]')].find(
    (candidate) => candidate.textContent?.trim().startsWith(prefix),
  )
}

describe("chat screen", () => {
  it("shows an empty state that asks for a workspace instead of fixture data", async () => {
    await screen.render({ workspace: null, workspaceOptions: [] })

    expect(screen.container.textContent).toContain("添加项目")
    expect(screen.container.textContent).not.toContain("最近工作区")
    expect(screen.container.textContent).not.toContain("发送第一条消息即开始会话")
    expect(screen.container.textContent).not.toContain("流开始后不再换号")
    expect(screen.container.textContent).not.toContain("继续上次")
  })

  it("offers Pigcode's start suggestions once a workspace is ready", async () => {
    await screen.render()

    expect(screen.container.textContent).toContain("解释项目")
    expect(screen.container.textContent).toContain("修复问题")
    expect(screen.container.textContent).toContain("补充测试")
    expect(screen.container.textContent).toContain("审查改动")
    expect(screen.container.textContent).not.toContain("最近工作区")
  })

  it("prefills the composer from a start suggestion without sending", async () => {
    await screen.render()

    await clickButton(buttonNamed("解释项目"), "解释项目")

    const editor = screen.container.querySelector<HTMLElement>(".composer .tiptap")
    expect(editor?.textContent).toContain("介绍一下这个项目")
  })

  it("starts a session with the selected workspace and session options", async () => {
    const session = controller()
    const onOpen = vi.fn()
    await screen.render({ session, workspace: "/Users/me/app", onOpen })

    await typeAndSend(screen.container, "开始吧")

    expect(session.start).toHaveBeenCalledWith({
      workspace: "/Users/me/app",
      model: "claude-sonnet",
      permissionMode: "default",
    })
    expect(session.send).toHaveBeenCalledWith("开始吧", { effort: null, fast: false })
    expect(onOpen).toHaveBeenCalledWith({ kind: "session" })
  })

  it("offers a direct account in the model picker without any proxy", async () => {
    await screen.render({
      accounts: [chatAccount("account-direct", "直连 Max", null)],
      proxies: [],
    })

    const trigger = screen.container.querySelector<HTMLButtonElement>(".model-chip")
    expect(trigger, "模型选择器").not.toBeNull()
    await act(async () => trigger?.click())

    expect(
      document.querySelector('[role="tab"][aria-label="直连 Max · 系统网络"]'),
      "账号实例",
    ).not.toBeNull()
  })

  it("does not submit while the input method is composing", async () => {
    const session = controller({
      state: reduceSession(createSessionState(), { type: "opened", sessionId: "session-1" }),
    })
    await screen.render({ fresh: false, session })

    const editor = screen.container.querySelector<HTMLElement>(".composer .tiptap")
    expect(editor, "输入区").not.toBeNull()
    const user = userEvent.setup()
    await act(async () => {
      await user.click(editor!)
      await user.type(editor!, "你好")
    })
    await act(async () => {
      editor!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
          isComposing: true,
        }),
      )
    })

    expect(session.send).not.toHaveBeenCalled()
    await act(async () => {
      editor!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      )
    })
    expect(session.send).toHaveBeenCalledWith("你好", { effort: null, fast: false })
  })

  it("shows the live thread even when the route is still chat-new", async () => {
    const onOpen = vi.fn()

    function Harness() {
      const [state, setState] = useState(createSessionState)
      const session = controller({
        state,
        start: async () => {
          setState((current) => {
            let next = reduceSession(current, { type: "starting" })
            next = reduceSession(next, { type: "opened", sessionId: "session-1" })
            next = reduceSession(next, {
              type: "user-message",
              text: "改一下",
              turnId: "turn-1",
              at: sessionTime,
            })
            return receive(
              next,
              { type: "delta", text: "先看", thinking: false, blockIndex: 0 },
              sessionTime,
            )
          })
          return true
        },
      })
      return chatScreenElement({
        session,
        accounts: [chatAccount("account-a", "主力 Max")],
        onOpen,
      })
    }

    await screen.renderElement(createElement(Harness))
    await typeAndSend(screen.container, "改一下")

    expect(onOpen).toHaveBeenCalledWith({ kind: "session" })
    expect(screen.container.textContent).toContain("先看")
    expect(screen.container.textContent).not.toContain("先选择一个工作区")
  })

  it("starts a new session after the previous one is stopped", async () => {
    const stopped = reduceSession(startingState(), { type: "stopped", at: sessionTime })
    const start = vi.fn(async () => true)
    await screen.render({ fresh: false, session: controller({ state: stopped, start }) })

    await typeAndSend(screen.container, "再来一次")
    expect(start).toHaveBeenCalledTimes(1)
  })

  it("renders streamed assistant text", async () => {
    let state = startingState()
    state = receive(
      state,
      { type: "delta", text: "先看", thinking: false, blockIndex: 0 },
      sessionTime,
    )
    state = receive(
      state,
      { type: "delta", text: "一下重试条件", thinking: false, blockIndex: 0 },
      sessionTime,
    )

    await screen.render({ fresh: false, session: controller({ state }) })

    expect(screen.container.textContent).toContain("先看一下重试条件")
    expect(screen.container.textContent).toContain("改一下重试逻辑")
  })

  it("folds terminal commands until the user expands them", async () => {
    // Pigcode 的时间线把命令显示成一行摘要，点开才看到输出。
    let state = startingState()
    state = receive(
      state,
      {
        type: "message",
        messageId: "m1",
        model: "claude-sonnet",
        subagent: null,
        blocks: [{ type: "tool-use", id: "tool-1", name: "Bash", input: { command: "cat a.ts" } }],
      },
      sessionTime,
    )
    state = receive(
      state,
      {
        type: "tool-result",
        toolUseId: "tool-1",
        content: "文件内容",
        isError: false,
        subagent: null,
      },
      sessionTime,
    )

    await screen.render({ fresh: false, session: controller({ state }) })

    expect(screen.container.textContent).toContain("终端")
    expect(screen.container.textContent).toContain("cat a.ts")
    expect(screen.container.textContent).not.toContain("文件内容")
    await clickButton(buttonStartingWith("终端"), "终端")
    expect(screen.container.textContent).toContain("文件内容")
  })

  it("answers permission cards from the prompt above the composer", async () => {
    const respond = vi.fn(async () => undefined)
    let state = startingState()
    state = receive(
      state,
      {
        type: "permission",
        requestId: "permission-1",
        toolName: "Bash",
        input: { command: "pnpm test" },
        subagent: null,
      },
      sessionTime,
    )
    await screen.render({
      fresh: false,
      session: controller({ state, respondPermission: respond }),
    })

    const prompt = screen.container.querySelector('[role="dialog"][aria-label="需要权限"]')
    expect(prompt).not.toBeNull()
    // 卡片挂在输入区容器里，排在输入框前面。
    expect(prompt?.closest(".composer-wrap")).not.toBeNull()
    expect(prompt?.closest(".perm-host")?.nextElementSibling?.className).toContain("composer")
    expect(screen.container.textContent).toContain("Bash")
    expect(screen.container.textContent).toContain("pnpm test")
    // 卡片默认选中第一项，点一下就直接回答。
    const options = [...screen.container.querySelectorAll<HTMLElement>('[role="option"]')]
    expect(options.length).toBe(2)
    await act(async () => options[0]?.click())
    expect(respond).toHaveBeenCalledWith("permission-1", "allow", undefined)

    await screen.render({
      fresh: false,
      session: controller({ state, respondPermission: respond }),
    })
    const deny = screen.container.querySelectorAll<HTMLElement>('[role="option"]')[1]
    await act(async () => deny?.click())
    await clickButton(buttonNamed("确认"), "确认")
    expect(respond).toHaveBeenCalledWith("permission-1", "deny", undefined)
  })

  it("shows account switch notices with display names", async () => {
    let state = startingState()
    state = receive(
      state,
      { type: "account-switched", from: "account-a", to: "account-b", reason: "quota" },
      sessionTime,
    )

    await screen.render({ fresh: false, session: controller({ state }) })

    // Pigcode 的切换分隔线只显示切换到的目标，不重复来源和原因。
    expect(screen.container.textContent).toContain("已切换到 备用 Pro")
  })

  it("interrupts the current run from the composer", async () => {
    const cancel = vi.fn(async () => undefined)
    await screen.render({
      fresh: false,
      session: controller({ state: startingState(), cancel }),
    })

    const stop = screen.container.querySelector<HTMLButtonElement>('[aria-label="中断"]')
    expect(stop, "中断").not.toBeNull()
    await act(async () => stop?.click())
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it("stays running after a result while a background task works and keeps new messages out", async () => {
    const send = vi.fn(async () => true)
    let state = receive(
      startingState(),
      { type: "turn-started", turnId: "main-turn-1" },
      sessionTime,
    )
    state = receive(
      state,
      {
        type: "result",
        subtype: "success",
        isError: false,
        durationMs: 9_882,
        numTurns: 2,
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
      },
      sessionTime,
    )
    await screen.render({ fresh: false, session: controller({ state, send }) })

    expect(screen.container.querySelector('[aria-label="中断"]'), "中断").not.toBeNull()
    await typeAndSend(screen.container, "下一步")
    expect(send).not.toHaveBeenCalled()
  })

  it("shows the mapped Chinese error text and model probe failures", async () => {
    const session = controller({
      state: reduceSession(startingState(), {
        type: "failed",
        at: sessionTime,
        message: "没有可用的 Claude 账号，请添加或重新授权",
        code: "NO_AVAILABLE_ACCOUNT",
      }),
      modelsLoading: false,
      modelsError: "Claude Code 不可用，请检查安装",
    })
    await screen.render({ fresh: false, session })

    expect(screen.container.querySelector('[role="alert"]')?.textContent).toContain(
      "没有可用的 Claude 账号",
    )
    expect(screen.container.textContent).toContain("Claude Code 不可用")
  })

  it("never puts credentials into the page or localStorage", async () => {
    await screen.render({ fresh: false, session: controller({ state: startingState() }) })

    const page = `${screen.container.innerHTML}${JSON.stringify({ ...window.localStorage })}`
    expect(page).not.toMatch(/accessToken|refreshToken|sk-ant-|Bearer /)
  })
})
