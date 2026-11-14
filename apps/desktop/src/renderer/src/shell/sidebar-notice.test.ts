// 负责验证侧栏提醒：会话进行时显示所用账号和网络，不出现代理地址；需要重新授权的提醒排在前面。

// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LocaleProvider } from "@pigclaude/ui-primitives"
import { SidebarNotice, sessionNotice, type SessionNotice } from "./sidebar-notice"

const accounts = [
  { id: "account-a", displayName: "主力 Max", proxyId: "proxy-1" },
  { id: "account-b", displayName: "直连 Pro", proxyId: null },
  { id: "account-c", displayName: "旧代理 Max", proxyId: "proxy-gone" },
]
const proxies = [{ id: "proxy-1", name: "东京出口" }]

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

async function render(props: {
  reauth?: { id: string; name: string }[]
  session?: SessionNotice | null
  onOpen?: () => void
}): Promise<void> {
  await act(async () =>
    root.render(
      createElement(LocaleProvider, {
        locale: "zh-CN",
        children: createElement(SidebarNotice, {
          accounts: props.reauth ?? [],
          session: props.session ?? null,
          onOpen: props.onOpen ?? (() => undefined),
        }),
      }),
    ),
  )
}

describe("sessionNotice", () => {
  it("names the account and its proxy while a session is running", () => {
    expect(sessionNotice({ live: true, accountId: "account-a", accounts, proxies })).toEqual({
      account: "主力 Max",
      network: { kind: "proxy", name: "东京出口" },
    })
  })

  it("says the system network for accounts without an app proxy", () => {
    expect(sessionNotice({ live: true, accountId: "account-b", accounts, proxies })).toEqual({
      account: "直连 Pro",
      network: { kind: "direct" },
    })
  })

  it("flags a bound proxy that no longer exists instead of calling it direct", () => {
    expect(sessionNotice({ live: true, accountId: "account-c", accounts, proxies })).toEqual({
      account: "旧代理 Max",
      network: { kind: "missing" },
    })
  })

  it("shows nothing before the session runs or while its account is unknown", () => {
    expect(sessionNotice({ live: false, accountId: "account-a", accounts, proxies })).toBeNull()
    expect(sessionNotice({ live: true, accountId: null, accounts, proxies })).toBeNull()
    expect(sessionNotice({ live: true, accountId: "removed", accounts, proxies })).toBeNull()
  })
})

describe("SidebarNotice", () => {
  it("shows the session account and network without any proxy address", async () => {
    const onOpen = vi.fn()
    await render({
      session: { account: "主力 Max", network: { kind: "proxy", name: "东京出口" } },
      onOpen,
    })

    expect(container.textContent).toContain("本次会话：主力 Max")
    expect(container.textContent).toContain("代理：东京出口")
    expect(container.innerHTML).not.toMatch(/https?:\/\/|127\.0\.0\.1/)
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click())
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it("keeps the re-authorization reminder above the session row", async () => {
    await render({
      reauth: [{ id: "account-x", name: "过期 Max" }],
      session: { account: "直连 Pro", network: { kind: "direct" } },
    })

    const text = container.textContent ?? ""
    expect(text).toContain("过期 Max 需要重新授权")
    expect(text).toContain("系统网络")
    expect(text.indexOf("需要重新授权")).toBeLessThan(text.indexOf("本次会话"))
  })

  it("renders nothing when there is neither a reminder nor a running session", async () => {
    await render({})

    expect(container.innerHTML).toBe("")
  })
})
