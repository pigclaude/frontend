// 验证浏览器事件只影响匹配的标签，以及 Agent 操作与手动控制在当前工具栏共存。
// @vitest-environment jsdom
import { act } from "react"
import { expect, it, vi } from "vitest"
import type { WorkbenchBrowserPage } from "../../../workbench-contract"
import { fakeWorkbench, panelTabs, workbenchRoot } from "../test-support/workbench-harness"

const screen = workbenchRoot()

it("removes only the browser tab closed by the main process", async () => {
  const fake = fakeWorkbench({})
  Object.assign(fake.bridge, {
    browserClose: vi.fn(async () => undefined),
    browserPresent: vi.fn(async () => undefined),
  })
  await screen.render(fake.bridge, { visible: false })
  await fake.emit({ type: "browser-open", id: "browser-1", url: "http://localhost:3001" })
  await fake.emit({
    type: "browser-page",
    id: "browser-1",
    page: {
      url: "http://localhost:3001",
      title: "first preview",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    },
  })
  await fake.emit({ type: "browser-open", id: "browser-2", url: "http://localhost:3002" })
  expect(panelTabs()).toHaveLength(2)

  await fake.emit({ type: "browser-close", id: "browser-2" })

  expect(panelTabs().map((tab) => tab.title)).toEqual(["first preview"])
})

it("shows and clears approved activity on the browser toolbar for that resource", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  )
  const fake = fakeWorkbench({})
  const browserCommand = vi.fn(async () => undefined)
  Object.assign(fake.bridge, {
    browserClose: vi.fn(async () => undefined),
    browserPresent: vi.fn(async () => undefined),
    browserCommand,
  })
  await screen.render(fake.bridge)
  const page: WorkbenchBrowserPage = {
    url: "http://localhost:4173/settings",
    title: "Settings",
    loading: false,
    canGoBack: true,
    canGoForward: false,
  }
  const manual = { ...page, url: "http://localhost:4321", title: "Manual preview" }
  const toolbar = () =>
    screen.container.querySelector(".surface-pane:not([hidden]) .browser-toolbar")
  const activity = () => toolbar()?.querySelector('[role="status"]')
  const show = async (id: string, next: WorkbenchBrowserPage) => {
    await fake.emit({ type: "browser-open", id, url: next.url })
    await fake.emit({ type: "browser-page", id, page: next })
  }

  await show("manual", manual)
  await show("agent", page)
  expect(activity()).toBeNull()

  await fake.emit({
    type: "browser-page",
    id: "agent",
    page: { ...page, activity: { kind: "navigate", target: page.url } },
  })
  expect(activity()?.textContent).toBe("Agent · 跳转 · http://localhost:4173/settings")
  expect(toolbar()?.querySelector("input")?.value).toBe(page.url)

  const back = toolbar()?.querySelector<HTMLButtonElement>('button[aria-label="后退"]')
  await act(async () => back?.click())
  expect(browserCommand).toHaveBeenCalledWith("agent", "back")

  await show("manual", manual)
  expect(activity()).toBeNull()
  expect(toolbar()?.querySelector("input")?.value).toBe(manual.url)

  await fake.emit({
    type: "browser-page",
    id: "agent",
    page: { ...page, activity: { kind: "click", target: "保存设置" } },
  })
  expect(activity()).toBeNull()
  await fake.emit({ type: "browser-open", id: "agent", url: page.url })
  expect(activity()?.textContent).toBe("Agent · 点击 · 保存设置")

  await fake.emit({
    type: "browser-page",
    id: "agent",
    page: { ...page, activity: { kind: "type", target: "搜索栏 e7" } },
  })
  expect(activity()?.textContent).toBe("Agent · 输入 · 搜索栏 e7")

  await fake.emit({ type: "browser-page", id: "agent", page })
  expect(activity()).toBeNull()
})
