// 负责验证代理页：添加、编辑、删除和逐个测试都调用桥，未测试的代理不显示为可用，代理密码不进入页面，操作错误可见。

// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ClaudeAccountView, ProxyView } from "@pigclaude/contracts/claude-account"
import { toPoolProxy } from "../models/claude-account-view"
import { ProxiesScreen, type ProxiesScreenProps } from "./proxies-screen"

const tested: ProxyView = {
  id: "la-01",
  name: "LA-01",
  url: "http://user:***@127.0.0.1:18080",
  lastTest: { ok: true, ip: "203.0.113.42", latencyMs: 186, testedAt: "2026-10-21T00:00:00.000Z" },
}

const untested: ProxyView = {
  id: "sea-03",
  name: "SEA-03",
  url: "http://127.0.0.1:18082",
  lastTest: null,
}

const failed: ProxyView = {
  id: "sjc-02",
  name: "SJC-02",
  url: "http://user:***@127.0.0.1:18081",
  lastTest: { ok: false, ip: null, latencyMs: 0, testedAt: "2026-10-21T00:00:00.000Z" },
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

async function render(
  views: ProxyView[],
  props: Partial<ProxiesScreenProps> = {},
  accounts: ClaudeAccountView[] = [],
): Promise<void> {
  await act(async () =>
    root.render(
      createElement(ProxiesScreen, {
        proxies: views.map((view) => toPoolProxy(view, accounts)),
        onTest: () => undefined,
        onSave: () => undefined,
        onRemove: () => undefined,
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

function labelled(label: string, scope: ParentNode = container): HTMLButtonElement | undefined {
  return scope.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? undefined
}

async function clickButton(target: HTMLButtonElement | undefined, name: string): Promise<void> {
  expect(target, name).toBeDefined()
  await act(async () => target?.click())
}

async function type(id: string, value: string): Promise<void> {
  const element = document.body.querySelector<HTMLInputElement>(`#${id}`)
  expect(element, id).not.toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value)
    element?.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function row(name: string): Element | undefined {
  return [...container.querySelectorAll(".item")].find((item) => item.textContent?.includes(name))
}

function dialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"]')
}

describe("proxies screen", () => {
  it("shows an empty state that points to adding an HTTP/HTTPS proxy", async () => {
    await render([])
    expect(container.textContent).toContain("还没有代理。添加一个出口固定的 HTTP/HTTPS 代理")
  })

  it("passes the trimmed url and name to the bridge when a proxy is added", async () => {
    const onSave = vi.fn()
    await render([tested], { onSave })
    await clickButton(button("添加代理"), "添加代理")

    expect(dialog()?.textContent).toContain("不支持 SOCKS5")
    expect(button("添加", dialog() ?? document.body)?.disabled).toBe(true)
    await type("proxy-url", "  http://user:secret@203.0.113.9:8000  ")
    await type("proxy-name", " LA-02 ")
    await clickButton(button("添加", dialog() ?? document.body), "添加")

    expect(onSave).toHaveBeenCalledWith({
      name: "LA-02",
      url: "http://user:secret@203.0.113.9:8000",
    })
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it("edits an existing proxy by re-entering its address", async () => {
    const onSave = vi.fn()
    await render([tested], { onSave })

    await clickButton(labelled("编辑 LA-01"), "编辑 LA-01")
    expect(dialog()?.textContent).toContain("编辑代理")
    expect(dialog()?.textContent).toContain("重新填写完整地址")

    await type("proxy-url", "http://user:new-secret@203.0.113.10:8000")
    await type("proxy-name", "LA-01b")
    await clickButton(button("保存", dialog() ?? document.body), "保存")

    expect(onSave).toHaveBeenCalledWith({
      id: "la-01",
      name: "LA-01b",
      url: "http://user:new-secret@203.0.113.10:8000",
    })
  })

  it("tests every proxy once and does not show untested or failed ones as available", async () => {
    const onTest = vi.fn(async () => undefined)
    await render([tested, untested, failed], { onTest })

    expect(row("LA-01")?.textContent).toContain("186 ms")
    expect(row("SEA-03")?.textContent).toContain("未通过测试")
    expect(row("SEA-03")?.textContent).toContain("待检测")
    expect(row("SJC-02")?.textContent).toContain("未通过测试")

    await clickButton(button("全部测试"), "全部测试")
    expect(onTest.mock.calls).toEqual([["la-01"], ["sea-03"], ["sjc-02"]])
    expect(button("全部测试")?.disabled).toBe(false)
  })

  it("tests and removes a single proxy", async () => {
    const onTest = vi.fn(async () => undefined)
    const onRemove = vi.fn(async () => undefined)
    await render([tested], { onTest, onRemove })

    await clickButton(labelled("测试 LA-01"), "测试 LA-01")
    expect(onTest).toHaveBeenCalledWith("la-01")

    await clickButton(labelled("删除 LA-01"), "删除 LA-01")
    expect(dialog()?.textContent).toContain("删除代理「LA-01」？")
    await clickButton(button("确认删除", dialog() ?? document.body), "确认删除")
    expect(onRemove).toHaveBeenCalledWith("la-01")
  })

  it("never shows the proxy url or its password", async () => {
    await render([tested, failed])
    expect(container.innerHTML).not.toContain("***")
    expect(container.innerHTML).not.toContain("127.0.0.1:1808")
    expect(container.innerHTML).not.toMatch(/user:/)
  })

  it("shows the error of the last proxy operation", async () => {
    await render([tested], { error: "代理只支持 HTTP/HTTPS" })
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("代理只支持 HTTP/HTTPS")
  })
})
