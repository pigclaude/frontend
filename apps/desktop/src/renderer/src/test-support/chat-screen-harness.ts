// 负责聊天页测试的公共夹具：账号、代理、会话控制器替身，以及带语言和 Toast 的聊天页渲染与输入。

import { act, createElement, type ReactElement } from "react"
import userEvent from "@testing-library/user-event"
import { expect, vi } from "vitest"
import type { ClaudeAccountView, ProxyView } from "@pigclaude/contracts/claude-account"
import { LocaleProvider } from "@pigclaude/ui-primitives"
import { ToastProvider } from "@pigclaude/ui-shell"
import type { SessionController } from "../hooks/use-session"
import { createSessionState, reduceSession, type SessionUiState } from "../models/session-model"
import { ChatScreen, type ChatScreenProps } from "../screens/chat-screen"

/** 绑定测试代理的 Claude 账号；proxyId 传 null 表示走系统网络。 */
export function chatAccount(
  id: string,
  displayName: string,
  proxyId: string | null = "proxy-1",
): ClaudeAccountView {
  return {
    id,
    displayName,
    enabled: true,
    email: null,
    subscriptionType: "max",
    needsReauth: false,
    credentialExpiresAt: 1_760_000_000_000,
    proxyId,
    fingerprint: {
      seed: "123456",
      brand: "Chrome",
      platform: "macos",
      lang: "en-US",
      timezone: "America/Los_Angeles",
      canvasNoise: "1",
      clientRectsNoise: "1",
    },
    createdAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
  }
}

/** 测试账号绑定的代理。 */
export const chatProxy: ProxyView = {
  id: "proxy-1",
  name: "代理",
  url: "http://127.0.0.1:8080",
  lastTest: null,
}

/** 已开始并发出第一条消息的会话状态。 */
export function startingState(): SessionUiState {
  let state = createSessionState()
  state = reduceSession(state, { type: "starting" })
  state = reduceSession(state, { type: "opened", sessionId: "session-1" })
  return reduceSession(state, { type: "user-message", text: "改一下重试逻辑", turnId: "turn-1" })
}

/** 会话控制器替身；命令都是记录调用的假函数。 */
export function sessionController(overrides: Partial<SessionController> = {}): SessionController {
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

/** 带中文语言包和 Toast 的聊天页；未给出的属性取一个有工作区和两个账号的草稿页。 */
export function chatScreenElement(overrides: Partial<ChatScreenProps> = {}): ReactElement {
  const props: ChatScreenProps = {
    fresh: true,
    session: sessionController(),
    workspace: "/Users/me/app",
    workspaceOptions: ["/Users/me/app"],
    accounts: [chatAccount("account-a", "主力 Max"), chatAccount("account-b", "备用 Pro")],
    proxies: [chatProxy],
    onPickWorkspace: () => undefined,
    onSelectWorkspace: () => undefined,
    onWorkspaceUsed: () => undefined,
    onOpen: () => undefined,
    smartPunctuation: false,
    ...overrides,
  }
  return createElement(LocaleProvider, {
    locale: "zh-CN",
    children: createElement(ToastProvider, { children: createElement(ChatScreen, props) }),
  })
}

/** 点击一个必须存在的元素。 */
export async function clickButton(target: HTMLElement | undefined, name: string): Promise<void> {
  expect(target, name).toBeDefined()
  await act(async () => target?.click())
}

/** 在输入区里敲字并回车；第一条消息会先建会话再发送。 */
export async function typeAndSend(container: ParentNode, text: string): Promise<void> {
  const editor = container.querySelector<HTMLElement>(".composer .tiptap")
  expect(editor, "输入区").not.toBeNull()
  const user = userEvent.setup()
  await act(async () => {
    await user.click(editor!)
    await user.type(editor!, text)
  })
  await act(async () => {
    editor!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    )
    await Promise.resolve()
  })
}
