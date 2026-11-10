// 验证账号向导只选择共享配置，复用不会共享登录数据，也不能上传第二份环境。
// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  defaultClaudeFingerprint,
  type ClaudeAccountView,
} from "@pigclaude/contracts/claude-account"
import type { BrowserProfileView } from "@pigclaude/contracts/browser-profile"
import { AuthorizeScreen } from "./authorize-screen"
import {
  createAuthorizationState,
  reduceAuthorizationState,
  type AuthorizationState,
} from "../models/authorization-model"

const profiles: BrowserProfileView[] = [
  {
    id: "us",
    name: "美国工作环境",
    proxyId: "p1",
    fingerprint: { ...defaultClaudeFingerprint(), lang: "en-US", timezone: "America/Chicago" },
    revision: 1,
    boundAccounts: [{ id: "other-account", name: "其他账号" }],
    inUse: true,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "jp",
    name: "日本工作环境",
    proxyId: null,
    fingerprint: { ...defaultClaudeFingerprint(), lang: "ja-JP", timezone: "Asia/Tokyo" },
    revision: 1,
    boundAccounts: [],
    inUse: false,
    createdAt: "",
    updatedAt: "",
  },
]
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

function render(
  options: {
    state?: Partial<AuthorizationState>
    profiles?: BrowserProfileView[]
    account?: ClaudeAccountView
    loading?: boolean
  } = {},
) {
  let state = { ...createAuthorizationState(), ...options.state }
  const start = vi.fn(),
    cancel = vi.fn(),
    manage = vi.fn()
  const draw = () =>
    root.render(
      createElement(AuthorizeScreen, {
        state,
        profiles: options.profiles ?? profiles,
        profilesLoading: options.loading,
        account: options.account,
        proxies: [
          {
            id: "p1",
            name: "当前代理",
            exit: "已核对",
            region: "US",
            latency: 1,
            accountId: null,
            available: true,
          },
        ],
        onEvent: (event) => {
          state = reduceAuthorizationState(state, event)
          draw()
        },
        onStartBrowserAuthorization: start,
        onCancel: cancel,
        onOpenProfiles: manage,
      }),
    )
  act(draw)
  return { start, cancel, manage }
}

async function click(label: string): Promise<void> {
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label || item.textContent?.includes(label),
  )
  if (!button) throw new Error(`找不到按钮 ${label}`)
  await act(async () => button.click())
}

describe("选择浏览器配置添加账号", () => {
  it("只提交配置 id，不从账号向导上传指纹或代理", async () => {
    const h = render()
    const field = container.querySelector<HTMLInputElement>("#authorize-name")
    if (!field) throw new Error("账号名称字段不存在")
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        field,
        "工作账号",
      )
      field.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await click("下一步")
    await click("美国工作环境")
    await click("使用此配置")
    expect(container.textContent).toContain("en-US · America/Chicago")
    await click("检测环境并准备授权")
    expect(h.start).toHaveBeenCalledOnce()
    expect(h.start.mock.calls[0]?.[0]).toEqual({
      accountId: undefined,
      displayName: "工作账号",
      browserProfileId: "us",
    })
    expect(h.start.mock.calls[0]?.[0]).not.toHaveProperty("fingerprint")
    expect(h.start.mock.calls[0]?.[0]).not.toHaveProperty("proxyId")
  })
  it("没有配置时要求先创建，不自动生成账号环境", async () => {
    const h = render({ profiles: [], state: { step: "proxy" } })
    expect(container.textContent).toContain("请先在号池中创建")
    await click("使用此配置")
    expect(h.start).not.toHaveBeenCalled()
    await click("管理浏览器指纹")
    expect(h.manage).toHaveBeenCalledOnce()
  })
  it("配置正在被其他账号读取时仍允许复用", async () => {
    const h = render({ state: { step: "proxy" } })
    await click("美国工作环境")
    await click("使用此配置")
    await click("检测环境并准备授权")
    expect(h.start).toHaveBeenCalledOnce()
  })
  it("重新授权沿用已绑定配置，不显示别的环境选项", async () => {
    const account: ClaudeAccountView = {
      id: "a",
      displayName: "旧账号",
      enabled: true,
      email: null,
      subscriptionType: null,
      needsReauth: true,
      credentialExpiresAt: null,
      proxyId: null,
      fingerprint: profiles[1]!.fingerprint,
      browserProfileId: "jp",
      createdAt: "",
      updatedAt: "",
    }
    const h = render({ account, state: { step: "proxy" } })
    expect(container.textContent).not.toContain("美国工作环境")
    await click("使用此配置")
    await click("检测环境并准备授权")
    expect(h.start.mock.calls[0]?.[0]).toEqual({
      accountId: "a",
      displayName: "旧账号",
      browserProfileId: "jp",
    })
  })
  it("返回选择配置保留选择，允许改为另一份现有配置", async () => {
    const h = render({ state: { step: "proxy" } })
    await click("美国工作环境")
    await click("使用此配置")
    await click("返回选择配置")
    await click("日本工作环境")
    await click("使用此配置")
    await click("检测环境并准备授权")
    expect(h.start.mock.calls[0]?.[0]).toMatchObject({ browserProfileId: "jp" })
  })
  it("同一次按钮连击只发起一次环境检测", async () => {
    const h = render({ state: { step: "exit", browserProfileId: "jp" } })
    await click("检测环境并准备授权")
    await click("检测环境并准备授权")
    expect(h.start).toHaveBeenCalledOnce()
  })
  it("配置缺失或还在加载时不能发起授权", async () => {
    const h = render({ state: { step: "exit", browserProfileId: "deleted" }, loading: true })
    await click("检测环境并准备授权")
    expect(h.start).not.toHaveBeenCalled()
  })
  it("等待浏览器时保留重检和取消入口，不在应用中输入 Claude 凭据", async () => {
    const h = render({ state: { step: "waiting", browserProfileId: "jp" } })
    expect(container.querySelector('input[type="password"]')).toBeNull()
    await click("重新自检")
    expect(h.start).toHaveBeenCalledOnce()
    await click("取消")
    expect(h.cancel).toHaveBeenCalled()
  })
})
