// 负责验证聊天页：空状态、开始会话、流式文本、工具折叠、权限卡片、换号提示、取消/停止和错误提示，且页面不出现凭据。

// @vitest-environment jsdom
import { act, createElement, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ClaudeAccountView, ProxyView } from "@pigclaude/contracts/claude-account"
import type { SessionController } from "../hooks/use-session"
import { createSessionState, reduceSession, type SessionUiState } from "../models/session-model"
import { ChatScreen, type ChatScreenProps } from "./chat-screen"

const account = (id: string, displayName: string): ClaudeAccountView => ({
  id,
  displayName,
  enabled: true,
  email: null,
  subscriptionType: "max",
  needsReauth: false,
  credentialExpiresAt: 1_760_000_000_000,
  proxyId: "proxy-1",
  fingerprint: {
    seed: "123456",
    brand: "Chrome",
    platform: "macos",
    lang: "en-US",
    timezone: "America/Los_Angeles",
    canvasNoise: true,
    clientRectsNoise: true,
  },
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
})

const proxy: ProxyView = {
  id: "proxy-1",
  name: "代理",
  url: "http://127.0.0.1:8080",
  lastTest: null,
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  window.localStorage.clear()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

function startingState(): SessionUiState {
  let state = createSessionState()
  state = reduceSession(state, { type: "starting" })
  state = reduceSession(state, { type: "opened", sessionId: "session-1" })
  return reduceSession(state, { type: "user-message", text: "改一下重试逻辑", turnId: "turn-1" })
}

function controller(overrides: Partial<SessionController> = {}): SessionController {
  return {
    state: createSessionState(),
    status: null,
    models: [{ id: "claude-sonnet", displayName: "Sonnet", description: "", isDefault: true }],
    modelsLoading: false,
    modelsError: null,
    start: vi.fn(async () => true),
    send: vi.fn(async () => true),
    cancel: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    respondPermission: vi.fn(async () => undefined),
    setMode: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    refreshModels: vi.fn(async () => undefined),
    cancelModels: vi.fn(() => undefined),
    refreshStatus: vi.fn(async () => undefined),
    clearError: vi.fn(() => undefined),
    ...overrides,
  }
}

async function render(overrides: Partial<ChatScreenProps> = {}): Promise<void> {
  const props: ChatScreenProps = {
    fresh: true,
    session: controller(),
    workspace: "/Users/me/app",
    workspaceOptions: ["/Users/me/app"],
    accounts: [account("account-a", "主力 Max"), account("account-b", "备用 Pro")],
    proxies: [proxy],
    onPickWorkspace: () => undefined,
    onSelectWorkspace: () => undefined,
    onWorkspaceUsed: () => undefined,
    onOpen: () => undefined,
    smartPunctuation: false,
    ...overrides,
  }
  await act(async () => root.render(createElement(ChatScreen, props)))
}

function button(name: string, scope: ParentNode = container): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  )
}

async function clickButton(target: HTMLButtonElement | undefined, name: string): Promise<void> {
  expect(target, name).toBeDefined()
  await act(async () => target?.click())
}

describe("chat screen", () => {
  it("shows an empty state that asks for a workspace instead of fixture data", async () => {
    await render({ workspace: null, workspaceOptions: [] })

    expect(container.textContent).toContain("选择工作区")
    expect(container.textContent).toContain("最近工作区")
    expect(container.textContent).not.toContain("流开始后不再换号")
    expect(container.textContent).not.toContain("继续上次")
  })

  it("starts a session with the selected workspace and session options", async () => {
    const session = controller()
    const onOpen = vi.fn()
    await render({ session, workspace: "/Users/me/app", onOpen })

    await clickButton(button("开始会话"), "开始会话")

    expect(session.start).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: "/Users/me/app",
        permissionMode: "default",
        thinking: "medium",
      }),
    )
    expect(session.send).not.toHaveBeenCalled()
    expect(onOpen).toHaveBeenCalledWith("chat")
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
            next = reduceSession(next, { type: "user-message", text: "改一下", turnId: "turn-1" })
            return reduceSession(next, {
              type: "event",
              event: { type: "delta", text: "先看", thinking: false, blockIndex: 0 },
            })
          })
          return true
        },
      })
      return createElement(ChatScreen, {
        fresh: true,
        session,
        workspace: "/Users/me/app",
        workspaceOptions: ["/Users/me/app"],
        accounts: [account("account-a", "主力 Max")],
        proxies: [proxy],
        onPickWorkspace: () => undefined,
        onSelectWorkspace: () => undefined,
        onWorkspaceUsed: () => undefined,
        onOpen,
        smartPunctuation: false,
      })
    }

    await act(async () => root.render(createElement(Harness)))
    await clickButton(button("开始会话"), "开始会话")

    expect(onOpen).toHaveBeenCalledWith("chat")
    expect(container.textContent).toContain("先看")
    expect(container.textContent).not.toContain("先选择一个工作区")
  })

  it("offers a new session after the previous one is stopped", async () => {
    const stopped = reduceSession(startingState(), { type: "stopped" })
    const start = vi.fn(async () => true)
    await render({ fresh: false, session: controller({ state: stopped, start }) })

    expect(container.textContent).toContain("开始会话")
    await clickButton(button("开始会话"), "开始会话")
    expect(start).toHaveBeenCalledTimes(1)
  })

  it("renders streamed assistant text", async () => {
    let state = startingState()
    state = reduceSession(state, {
      type: "event",
      event: { type: "delta", text: "先看", thinking: false, blockIndex: 0 },
    })
    state = reduceSession(state, {
      type: "event",
      event: { type: "delta", text: "一下重试条件", thinking: false, blockIndex: 0 },
    })

    await render({ fresh: false, session: controller({ state }) })

    expect(container.textContent).toContain("先看一下重试条件")
    expect(container.textContent).toContain("改一下重试逻辑")
  })

  it("folds tool calls until the user expands them", async () => {
    let state = startingState()
    state = reduceSession(state, {
      type: "event",
      event: {
        type: "message",
        messageId: "m1",
        model: "claude-sonnet",
        parentToolUseId: null,
        blocks: [{ type: "tool-use", id: "tool-1", name: "Read", input: { file: "a.ts" } }],
      },
    })
    state = reduceSession(state, {
      type: "event",
      event: { type: "tool-result", toolUseId: "tool-1", content: "文件内容", isError: false },
    })

    await render({ fresh: false, session: controller({ state }) })

    expect(container.textContent).toContain("工具调用 1 次")
    expect(container.textContent).not.toContain("文件内容")
    await clickButton(button("工具调用 1 次"), "工具调用 1 次")
    expect(container.textContent).toContain("Read")
    expect(container.textContent).toContain("文件内容")
  })

  it("answers permission cards with allow or deny", async () => {
    const respond = vi.fn(async () => undefined)
    let state = startingState()
    state = reduceSession(state, {
      type: "event",
      event: {
        type: "permission",
        requestId: "permission-1",
        toolName: "Bash",
        input: { command: "pnpm test" },
      },
    })
    await render({ fresh: false, session: controller({ state, respondPermission: respond }) })

    expect(container.textContent).toContain("允许运行 Bash")
    await clickButton(button("允许一次"), "允许一次")
    expect(respond).toHaveBeenCalledWith("permission-1", "allow")

    await render({ fresh: false, session: controller({ state, respondPermission: respond }) })
    await clickButton(button("拒绝"), "拒绝")
    expect(respond).toHaveBeenCalledWith("permission-1", "deny")
  })

  it("shows account switch notices with display names", async () => {
    let state = startingState()
    state = reduceSession(state, {
      type: "event",
      event: { type: "account-switched", from: "account-a", to: "account-b", reason: "quota" },
    })

    await render({ fresh: false, session: controller({ state }) })

    expect(container.textContent).toContain("主力 Max")
    expect(container.textContent).toContain("备用 Pro")
    expect(container.textContent).toContain("额度用尽")
  })

  it("cancels the current turn or stops the whole session", async () => {
    const cancel = vi.fn(async () => undefined)
    const stop = vi.fn(async () => undefined)
    await render({
      fresh: false,
      session: controller({ state: startingState(), cancel, stop }),
    })

    await clickButton(button("取消"), "取消")
    expect(cancel).toHaveBeenCalledTimes(1)
    await clickButton(button("停止会话"), "停止会话")
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it("shows the mapped Chinese error text and model probe failures", async () => {
    const session = controller({
      state: reduceSession(startingState(), {
        type: "failed",
        message: "没有可用的 Claude 账号，请添加或重新授权",
        code: "NO_AVAILABLE_ACCOUNT",
      }),
      modelsLoading: false,
      modelsError: "Claude Code 不可用，请检查安装",
    })
    await render({ fresh: false, session })

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "没有可用的 Claude 账号",
    )
    expect(container.textContent).toContain("Claude Code 不可用")
  })

  it("never puts credentials into the page or localStorage", async () => {
    await render({ fresh: false, session: controller({ state: startingState() }) })

    const page = `${container.innerHTML}${JSON.stringify({ ...window.localStorage })}`
    expect(page).not.toMatch(/accessToken|refreshToken|sk-ant-|Bearer /)
  })
})
