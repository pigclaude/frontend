// 负责验证浏览器配置弹层的代理选择：系统网络与真实代理在保存时的取值，以及原代理丢失时的提示。

// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { defaultClaudeFingerprint, type ProxyView } from "@pigclaude/contracts/claude-account"
import type {
  BrowserProfileView,
  SaveBrowserProfileInput,
} from "@pigclaude/contracts/browser-profile"
import { BrowserProfileDialog } from "./browser-profile-dialog"
import { chooseSelect } from "../test-support/base-ui-select"

let root: Root
let container: HTMLDivElement

const proxies: ProxyView[] = [
  {
    id: "p-la",
    name: "LA-01",
    url: "http://***@203.0.113.42:8000",
    lastTest: { ok: true, ip: "203.0.113.42", latencyMs: 186, testedAt: "2026-11-11T00:00:00Z" },
  },
]

function profile(proxyId: string | null): BrowserProfileView {
  return {
    id: "profile-1",
    name: "美国工作环境",
    proxyId,
    fingerprint: defaultClaudeFingerprint(),
    revision: 3,
    boundAccounts: [],
    inUse: false,
    createdAt: "",
    updatedAt: "",
  }
}

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

async function render(
  current: BrowserProfileView,
  onSave: (input: SaveBrowserProfileInput) => Promise<void>,
): Promise<void> {
  await act(async () =>
    root.render(
      createElement(BrowserProfileDialog, {
        profile: current,
        proxies,
        onClose: () => undefined,
        onSave,
        onRegion: async () => ({
          ip: "203.0.113.42",
          countryCode: "US",
          locale: "en-US",
          timezone: "America/Los_Angeles",
        }),
      }),
    ),
  )
}

function trigger(): HTMLElement {
  const element = document.getElementById("browser-profile-proxy")
  if (!element) throw new Error("代理选择不存在")
  return element
}

async function save(): Promise<void> {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === "保存配置",
  )
  if (!button) throw new Error("保存按钮不存在")
  await act(async () => button.click())
}

describe("BrowserProfileDialog proxy picker", () => {
  it("saves the system network choice as no proxy", async () => {
    const onSave = vi.fn(async () => undefined)
    await render(profile("p-la"), onSave)
    expect(trigger().textContent).toContain("LA-01")

    await chooseSelect(trigger(), "不使用代理（系统网络）")
    await save()

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ proxyId: null }))
  })

  it("saves a chosen proxy by its id", async () => {
    const onSave = vi.fn(async () => undefined)
    await render(profile(null), onSave)
    expect(trigger().textContent).toContain("不使用代理（系统网络）")

    await chooseSelect(trigger(), "LA-01 · 203.0.113.42")
    await save()

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ proxyId: "p-la" }))
  })

  it("names a proxy that no longer exists instead of showing it as system network", async () => {
    await render(
      profile("gone"),
      vi.fn(async () => undefined),
    )
    expect(trigger().textContent).toContain("原代理已不存在，请重新选择")
  })
})
