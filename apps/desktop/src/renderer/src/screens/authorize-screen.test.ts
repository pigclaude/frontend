// 负责验证 Claude 账号授权向导：逐步填写后提交完整指纹；重新授权沿用已保存的代理和指纹；出口核对失败时停在「请勿登录」，只能重新核对。
// @vitest-environment jsdom
import { act, createElement, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ClaudeAccountView } from "@pigclaude/contracts/claude-account"
import type { PoolProxy } from "../fixtures/pool-fixtures"
import {
  createAuthorizationState,
  reduceAuthorizationState,
  type AuthorizationState,
} from "../models/authorization-model"
import { AuthorizeScreen, type AuthorizeScreenProps } from "./authorize-screen"

type StartInput = Parameters<AuthorizeScreenProps["onStartBrowserAuthorization"]>[0]

const proxies: PoolProxy[] = [
  {
    id: "la-01",
    name: "LA-01",
    exit: "203.0.113.42",
    region: "已测试",
    latency: 186,
    accountId: null,
    available: true,
  },
  {
    id: "sjc-02",
    name: "SJC-02",
    exit: "198.51.100.17",
    region: "已测试",
    latency: 172,
    accountId: null,
    available: true,
  },
]

const savedAccount: ClaudeAccountView = {
  id: "acc-1",
  displayName: "旧号 Pro",
  enabled: true,
  email: "old•••@example.com",
  subscriptionType: "pro",
  needsReauth: true,
  credentialExpiresAt: null,
  proxyId: "sjc-02",
  fingerprint: {
    seed: "520117",
    brand: "Edge",
    platform: "windows",
    lang: "ja-JP",
    timezone: "Asia/Tokyo",
    canvasNoise: false,
    clientRectsNoise: true,
  },
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
}

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

/** 像 DesktopApp 一样用 reducer 持有向导状态。 */
function Wizard(props: {
  proxies: PoolProxy[]
  account?: ClaudeAccountView | null
  initial?: AuthorizationState
  onStart: (input: StartInput) => void
}) {
  const [state, setState] = useState(props.initial ?? createAuthorizationState())
  return createElement(AuthorizeScreen, {
    state,
    proxies: props.proxies,
    account: props.account,
    onEvent: (event) => setState((current) => reduceAuthorizationState(current, event)),
    onStartBrowserAuthorization: props.onStart,
    onCancel: () => undefined,
  })
}

async function render(props: Parameters<typeof Wizard>[0]): Promise<void> {
  await act(async () => root.render(createElement(Wizard, props)))
}

function button(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  )
}

async function click(name: string): Promise<void> {
  const target = button(name)
  expect(target, name).toBeDefined()
  await act(async () => target?.click())
}

function input(id: string): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>(`#${id}`)
  expect(element, id).not.toBeNull()
  return element as HTMLInputElement
}

async function type(id: string, value: string): Promise<void> {
  const element = input(id)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("Claude account authorization wizard", () => {
  it("submits the name, the chosen proxy and every fingerprint field", async () => {
    const onStart = vi.fn()
    await render({ proxies, onStart })

    expect(container.textContent).toContain("添加 Claude 账号")
    await type("authorize-name", "工作 Max")
    await click("下一步")
    const sjc = [...container.querySelectorAll("button.choice")].find((choice) =>
      choice.textContent?.includes("SJC-02"),
    )
    await act(async () => (sjc as HTMLButtonElement | undefined)?.click())
    await click("绑定代理")
    await type("authorize-timezone", "America/New_York")
    const canvas = container.querySelector<HTMLInputElement>('input[type="checkbox"]')
    await act(async () => canvas?.click())
    await click("保存并核对出口")

    expect(container.textContent).toContain("SJC-02 · 198.51.100.17")
    await click("开始核对并授权")
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onStart).toHaveBeenCalledWith({
      accountId: undefined,
      displayName: "工作 Max",
      proxyId: "sjc-02",
      fingerprint: {
        seed: "123456",
        brand: "Chrome",
        platform: "macos",
        lang: "en-US",
        timezone: "America/New_York",
        canvasNoise: false,
        clientRectsNoise: true,
      },
    })
  })

  it("reauthorizes with the saved proxy and fingerprint", async () => {
    const onStart = vi.fn()
    await render({ proxies, account: savedAccount, onStart })

    expect(container.textContent).toContain("重新授权 Claude 账号")
    expect(input("authorize-name").value).toBe("旧号 Pro")
    await click("下一步")
    expect(container.querySelector("button.choice.is-selected")?.textContent).toContain("SJC-02")
    await click("绑定代理")
    expect(input("authorize-fingerprint").value).toBe("520117")
    expect(input("authorize-platform").value).toBe("windows")
    await click("保存并核对出口")
    await click("开始核对并授权")

    expect(onStart).toHaveBeenCalledWith({
      accountId: "acc-1",
      displayName: "旧号 Pro",
      proxyId: "sjc-02",
      fingerprint: savedAccount.fingerprint,
    })
  })

  it("stops at 请勿登录 after a failed exit check and only offers another check", async () => {
    const onStart = vi.fn()
    const initial = { ...createAuthorizationState(), step: "exit" as const, error: "请勿登录" }
    await render({ proxies, initial, onStart })

    expect(container.querySelector(".error-text")?.textContent).toBe("请勿登录")
    expect(container.textContent).not.toContain("等待浏览器确认")
    expect(button("开始核对并授权")).toBeUndefined()
    expect(button("打开浏览器授权")).toBeUndefined()

    await click("重新核对")
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it("asks for a proxy before binding when the pool is empty", async () => {
    await render({ proxies: [], onStart: vi.fn() })
    await click("下一步")

    expect(container.textContent).toContain("还没有代理。先在代理页添加一个 HTTP/HTTPS 代理。")
    expect(button("绑定代理")?.disabled).toBe(true)
  })
})
