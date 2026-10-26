// 负责验证设置页的代理文案：代理可选、直连账号使用系统网络、已绑定代理的请求不会直连。

// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SessionSettings } from "./settings-app-pages"
import { NetworkSettings } from "./settings-system-pages"

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

describe("settings proxy copy", () => {
  it("describes proxies as optional and direct accounts as system network", async () => {
    await act(async () => root.render(createElement(NetworkSettings)))

    expect(container.textContent).toContain("代理可选")
    expect(container.textContent).toContain(
      "未绑定代理的账号使用系统网络；已绑定代理的请求不会直连",
    )
    expect(container.textContent).toContain("已绑定代理的请求失败，不会回退到系统网络直连")
  })

  it("keeps the session time zone tied to the optional proxy", async () => {
    await act(async () => root.render(createElement(SessionSettings)))

    expect(container.textContent).toContain("已绑定代理时跟随代理出口，未绑定代理时使用系统网络")
  })
})
