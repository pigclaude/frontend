// 负责验证账号页：空状态、需重新授权的账号单独列出、删除要先确认、删除失败时保留记录并显示错误、页面不出现凭据。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ClaudeAccountView, ProxyView } from "@pigclaude/contracts/claude-account"
import { toPoolAccount, toPoolProxy } from "../models/claude-account-view"
import { AccountsScreen, type AccountsScreenProps } from "./accounts-screen"

const fingerprint = {
  seed: "123456",
  brand: "Chrome",
  platform: "macos",
  lang: "en-US",
  timezone: "America/Los_Angeles",
  canvasNoise: true,
  clientRectsNoise: true,
}

const proxy: ProxyView = {
  id: "la-01",
  name: "LA-01",
  url: "http://user:***@127.0.0.1:18080",
  lastTest: { ok: true, ip: "203.0.113.42", latencyMs: 186, testedAt: "2026-10-21T00:00:00.000Z" },
}

const ready: ClaudeAccountView = {
  id: "acc-ready",
  displayName: "工作 Max",
  enabled: true,
  email: "work•••@example.com",
  subscriptionType: "max",
  needsReauth: false,
  credentialExpiresAt: 4_102_444_800_000,
  proxyId: "la-01",
  fingerprint,
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
}

const expired: ClaudeAccountView = {
  ...ready,
  id: "acc-expired",
  displayName: "旧号 Pro",
  subscriptionType: "pro",
  needsReauth: true,
  credentialExpiresAt: null,
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

async function render(
  views: ClaudeAccountView[],
  props: Partial<AccountsScreenProps> = {},
): Promise<void> {
  await act(async () =>
    root.render(
      createElement(AccountsScreen, {
        accounts: views.map((view) => toPoolAccount(view, [proxy])),
        proxies: [toPoolProxy(proxy, views)],
        onOpenAuthorize: () => undefined,
        onRemove: () => undefined,
        onUpdate: () => undefined,
        ...props,
      }),
    ),
  )
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

async function openAccount(name: string): Promise<void> {
  const row = [...container.querySelectorAll("button.item")].find((item) =>
    item.textContent?.includes(name),
  )
  await clickButton(row as HTMLButtonElement | undefined, name)
}

function dialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"]')
}

describe("accounts screen", () => {
  it("shows an empty state and the add button when there is no account", async () => {
    const onOpenAuthorize = vi.fn()
    await render([], { onOpenAuthorize })

    expect(container.textContent).toContain("还没有 Claude 账号")
    await clickButton(button("添加账号"), "添加账号")
    expect(onOpenAuthorize).toHaveBeenCalledTimes(1)
  })

  it("lists accounts that need reauthorization apart from the switch order", async () => {
    const onReauthorize = vi.fn()
    await render([ready, expired], { onReauthorize })

    const sections = [...container.querySelectorAll("section.section")]
    expect(sections[0]?.textContent).toContain("需要处理")
    expect(sections[0]?.textContent).toContain("旧号 Pro")
    expect(sections[0]?.textContent).toContain("需重新授权")
    expect(sections[1]?.textContent).toContain("工作 Max")
    expect(sections[1]?.textContent).not.toContain("旧号 Pro")

    await openAccount("旧号 Pro")
    expect(container.textContent).toContain("需要重新授权")
    await clickButton(button("重新授权"), "重新授权")
    expect(onReauthorize).toHaveBeenCalledWith("acc-expired")
  })

  it("removes an account only after the delete is confirmed", async () => {
    const onRemove = vi.fn()
    await render([ready], { onRemove })
    await openAccount("工作 Max")
    await clickButton(button("删除"), "删除")

    expect(dialog()?.textContent).toContain("删除「工作 Max」？")
    await clickButton(button("取消", dialog() ?? document.body), "取消")
    expect(onRemove).not.toHaveBeenCalled()

    await clickButton(button("删除"), "删除")
    await clickButton(button("删除", dialog() ?? document.body), "确认删除")
    expect(onRemove).toHaveBeenCalledWith("acc-ready")
  })

  it("keeps the account and shows the error when the browser profile cannot be deleted", async () => {
    let failure: string | null = null
    const onRemove = vi.fn(() => {
      failure = "删除浏览器配置目录失败"
    })
    await render([ready], { onRemove })
    await openAccount("工作 Max")
    await clickButton(button("删除"), "删除")
    await clickButton(button("删除", dialog() ?? document.body), "确认删除")
    expect(onRemove).toHaveBeenCalledTimes(1)

    await render([ready], { onRemove, error: failure })
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("删除浏览器配置目录失败")
    expect(container.textContent).toContain("工作 Max")
  })

  it("never puts credentials into the page or localStorage", async () => {
    await render([ready, expired])
    await openAccount("工作 Max")

    const page = `${container.innerHTML}${JSON.stringify({ ...window.localStorage })}`
    expect(page).not.toMatch(/accessToken|refreshToken|sk-ant-|Bearer /)
    expect(container.textContent).toContain("已保存")
  })
})
