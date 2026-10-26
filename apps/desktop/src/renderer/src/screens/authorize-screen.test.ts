// 负责验证 Claude 账号授权向导：分组指纹表单、预设、三态噪声、完整对象提交、返回修改、重新授权沿用和出口失败。
// @vitest-environment jsdom
import { act, createElement, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ClaudeAccountView, ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
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

const savedFingerprint: ClaudeFingerprintView = {
  seed: "520117",
  brand: "Edge",
  platform: "windows",
  lang: "ja-JP",
  timezone: "Asia/Tokyo",
  canvasNoise: "0",
  clientRectsNoise: "1",
  brandVersion: "144.0.7559.132",
  platformVersion: "10.0.0",
  acceptLang: "ja-JP,ja",
  resolution: "1920,1080",
  customResolution: "",
  hardwareConcurrency: "8",
  webrtcPolicy: "disable_non_proxied_udp",
  disableSpoofing: ["font"],
  colorDepth: "",
  deviceMemory: "",
  touchPoints: "",
  doNotTrack: "",
  mediaDevices: "",
  audioNoise: "",
  fontList: "",
  webglVendor: "",
  webglRenderer: "",
  unknownArgs: [],
}

const savedAccount: ClaudeAccountView = {
  id: "acc-1",
  displayName: "旧号 Pro",
  enabled: true,
  email: "old•••@example.com",
  subscriptionType: "pro",
  needsReauth: true,
  credentialExpiresAt: null,
  proxyId: "sjc-02",
  fingerprint: savedFingerprint,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
}

const directAccount: ClaudeAccountView = {
  ...savedAccount,
  displayName: "直连账号",
  proxyId: null,
}

const danglingAccount: ClaudeAccountView = {
  ...savedAccount,
  displayName: "悬空账号",
  proxyId: "deleted-proxy",
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

async function clickId(id: string): Promise<void> {
  const target = container.querySelector<HTMLButtonElement>(`#${id}`)
  expect(target, id).not.toBeNull()
  await act(async () => target?.click())
}

function input(id: string): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>(`#${id}`)
  expect(element, id).not.toBeNull()
  return element as HTMLInputElement
}

function select(id: string): HTMLSelectElement {
  const element = container.querySelector<HTMLSelectElement>(`#${id}`)
  expect(element, id).not.toBeNull()
  return element as HTMLSelectElement
}

async function type(id: string, value: string): Promise<void> {
  const element = input(id)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function choose(id: string, value: string): Promise<void> {
  const element = select(id)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(element, value)
    element.dispatchEvent(new Event("change", { bubbles: true }))
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

    // 指纹步骤按 AntBrowser 分组渲染，预设、身份、设备、兼容和高级参数都在同一页。
    expect(container.textContent).toContain("快速生成")
    expect(container.textContent).toContain("身份与定位")
    expect(container.textContent).toContain("设备与网络")
    expect(container.textContent).toContain("兼容伪装")
    expect(container.textContent).toContain("高级原始参数")

    await clickId("authorize-preset-win-chrome-office")
    await type("authorize-seed", "123456")
    await type("authorize-timezone", "America/New_York")
    await choose("authorize-webrtcPolicy", "disable_non_proxied_udp")
    await clickId("authorize-canvasNoise-0")
    await click("保存并核对出口")

    expect(container.textContent).toContain("SJC-02 · 198.51.100.17")
    expect(container.textContent).toContain("Chrome 144.0.7559.132 · Windows 10.0.0")
    await click("开始核对并授权")
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onStart).toHaveBeenCalledWith({
      accountId: undefined,
      displayName: "工作 Max",
      proxyId: "sjc-02",
      fingerprint: {
        seed: "123456",
        brand: "Chrome",
        platform: "windows",
        lang: "en-US",
        timezone: "America/New_York",
        canvasNoise: "0",
        clientRectsNoise: "1",
        brandVersion: "144.0.7559.132",
        platformVersion: "10.0.0",
        acceptLang: "en-US,en",
        resolution: "1920,1080",
        customResolution: "",
        hardwareConcurrency: "8",
        webrtcPolicy: "disable_non_proxied_udp",
        disableSpoofing: [],
        colorDepth: "",
        deviceMemory: "",
        touchPoints: "",
        doNotTrack: "",
        mediaDevices: "",
        audioNoise: "",
        fontList: "",
        webglVendor: "",
        webglRenderer: "",
        unknownArgs: [],
      },
    })
  })

  it("shows field-level errors and stays on the fingerprint step", async () => {
    const onStart = vi.fn()
    await render({ proxies: [], onStart })
    await click("下一步")
    await click("使用系统网络")

    await type("authorize-seed", "not-a-number")
    await type("authorize-hardwareConcurrency", "0")
    await click("保存并继续")

    expect(container.textContent).toContain("指纹种子必须是 1 到 2147483647 的整数")
    expect(container.textContent).toContain("CPU 核心数必须是 1 到 128 的整数")
    expect(onStart).not.toHaveBeenCalled()

    await type("authorize-seed", "654321")
    await type("authorize-hardwareConcurrency", "8")
    await click("保存并继续")
    expect(container.textContent).toContain("系统网络（直连）")
  })

  it("returns from the exit step to edit the fingerprint", async () => {
    const onStart = vi.fn()
    await render({ proxies: [], onStart })
    await click("下一步")
    await click("使用系统网络")
    await type("authorize-seed", "654321")
    await click("保存并继续")

    await click("返回修改指纹")
    expect(input("authorize-seed").value).toBe("654321")
    expect(container.textContent).toContain("快速生成")
  })

  it("reauthorizes with the saved proxy and every saved fingerprint field", async () => {
    const onStart = vi.fn()
    await render({ proxies, account: savedAccount, onStart })

    expect(container.textContent).toContain("重新授权 Claude 账号")
    expect(input("authorize-name").value).toBe("旧号 Pro")
    await click("下一步")
    expect(container.querySelector("button.choice.is-selected")?.textContent).toContain("SJC-02")
    await click("绑定代理")
    expect(input("authorize-seed").value).toBe("520117")
    expect(select("authorize-platform").value).toBe("windows")
    expect(select("authorize-brand").value).toBe("Edge")
    await click("保存并核对出口")
    await click("开始核对并授权")

    expect(onStart).toHaveBeenCalledWith({
      accountId: "acc-1",
      displayName: "旧号 Pro",
      proxyId: "sjc-02",
      fingerprint: savedFingerprint,
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

  it("continues with the system network when the proxy pool is empty", async () => {
    const onStart = vi.fn()
    await render({ proxies: [], onStart })
    await click("下一步")

    expect(container.textContent).toContain("还没有代理。也可以继续使用系统网络。")
    expect(container.querySelector("button.choice.is-selected")?.textContent).toContain(
      "不使用代理（系统网络）",
    )
    await click("使用系统网络")
    await click("保存并继续")

    expect(container.textContent).toContain("系统网络（直连）")
    expect(container.textContent).toContain("系统网络，无需出口核对")
    await click("开始授权")
    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: undefined, proxyId: null }),
    )
  })

  it("requires an explicit choice when the bound proxy no longer exists", async () => {
    const onStart = vi.fn()
    await render({ proxies, account: danglingAccount, onStart })
    await click("下一步")

    expect(container.textContent).toContain("原代理已不存在，请重新选择网络出口")
    expect(container.querySelector("button.choice.is-selected")).toBeNull()
    expect(button("请选择网络出口")?.disabled).toBe(true)

    const existing = [...container.querySelectorAll("button.choice")].find((choice) =>
      choice.textContent?.includes("SJC-02"),
    )
    await act(async () => (existing as HTMLButtonElement | undefined)?.click())
    expect(button("绑定代理")?.disabled).toBe(false)

    const direct = [...container.querySelectorAll("button.choice")].find((choice) =>
      choice.textContent?.includes("不使用代理（系统网络）"),
    )
    await act(async () => (direct as HTMLButtonElement | undefined)?.click())
    await click("使用系统网络")
    await click("保存并继续")
    await click("开始授权")

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "acc-1", proxyId: null }),
    )
  })

  it("defaults a direct account to the system network when reauthorizing", async () => {
    const onStart = vi.fn()
    await render({ proxies, account: directAccount, onStart })
    await click("下一步")

    expect(container.querySelector("button.choice.is-selected")?.textContent).toContain(
      "不使用代理（系统网络）",
    )
    await click("使用系统网络")
    await click("保存并继续")
    await click("开始授权")

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "acc-1", proxyId: null }),
    )
  })
})
