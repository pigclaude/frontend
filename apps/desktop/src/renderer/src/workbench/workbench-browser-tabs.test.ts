// 验证工作台只展示当前会话的 Agent 浏览器，切换、关闭和迟到事件不改变其他会话。
// @vitest-environment jsdom
import { act } from "react"
import { expect, it, vi } from "vitest"
import type { AgentBrowserTab, WorkbenchBridge } from "../../../workbench-contract"
import { fakeWorkbench, panelTabs, workbenchRoot } from "../test-support/workbench-harness"

const screen = workbenchRoot()

function tab(id: string, sessionId: string, title: string): AgentBrowserTab {
  return {
    id,
    sessionId,
    page: {
      url: `http://localhost:3001/${id}`,
      title,
      loading: false,
      canGoBack: false,
      canGoForward: false,
    },
  }
}

function setup() {
  const fake = fakeWorkbench({})
  const tabs = new Map<string, AgentBrowserTab[]>()
  const list = vi.fn(async (id: string) => tabs.get(id) ?? [])
  const close = vi.fn(async () => undefined)
  Object.assign(fake.bridge, {
    browserClose: close,
    browserPresent: vi.fn(async () => undefined),
    browserListAgentTabs: list,
  })
  return { ...fake, tabs, close, list }
}

it("never opens a background session's page in the visible workbench", async () => {
  const fake = setup()
  const show = vi.fn()
  const first = tab("first", "visible", "foreground preview")
  const second = tab("second", "background", "background preview")
  fake.tabs.set(first.sessionId, [first])
  fake.tabs.set(second.sessionId, [second])
  await screen.render(fake.bridge, { visible: false, sessionId: "visible", onShow: show })
  await fake.emit({
    type: "browser-open",
    id: second.id,
    sessionId: second.sessionId,
    url: second.page.url,
  })

  expect(panelTabs().map(({ title }) => title)).toEqual(["foreground preview"])
  expect(show).not.toHaveBeenCalled()
  await screen.render(fake.bridge, {
    visible: false,
    root: "/another/project",
    sessionId: "background",
  })
  expect(panelTabs().map(({ title }) => title)).toEqual(["background preview"])
  expect(fake.close).not.toHaveBeenCalled()
})

it("ignores a stale open after closing an Agent browser and shows the fresh resumed tab", async () => {
  const fake = setup()
  const show = vi.fn()
  const first = tab("first", "session", "first preview")
  const past = tab("past", "session", "closed preview")
  fake.tabs.set("session", [first, past])
  await screen.render(fake.bridge, { visible: false, sessionId: "session", onShow: show })
  expect(panelTabs().map(({ title }) => title)).toEqual(["first preview", "closed preview"])

  fake.tabs.set("session", [first])
  await fake.emit({ type: "browser-close", id: past.id, sessionId: "session" })
  await fake.emit({ type: "browser-open", id: past.id, sessionId: "session", url: past.page.url })
  expect(panelTabs().map(({ title }) => title)).toEqual(["first preview"])
  expect(show).not.toHaveBeenCalled()

  const fresh = tab("fresh", "session", "fresh preview")
  fake.tabs.set("session", [first, fresh])
  await fake.emit({ type: "browser-open", id: fresh.id, sessionId: "session", url: fresh.page.url })
  await fake.emit({ type: "browser-close", id: past.id, sessionId: "session" })
  expect(panelTabs().map(({ title }) => title)).toEqual(["first preview", "fresh preview"])
  expect(show).toHaveBeenCalledOnce()
})

it("discards a delayed tab list after switching to another session", async () => {
  const fake = setup()
  const first = tab("first", "session-a", "stale result")
  const second = tab("second", "session-b", "current result")
  let resolve: (tabs: AgentBrowserTab[]) => void = () => undefined
  const pending = new Promise<AgentBrowserTab[]>((done) => {
    resolve = done
  })
  fake.list.mockImplementation((id) =>
    id === first.sessionId ? pending : Promise.resolve([second]),
  )

  await screen.render(fake.bridge, { visible: false, sessionId: first.sessionId })
  await screen.render(fake.bridge, { visible: false, sessionId: second.sessionId })
  await act(async () => resolve([first]))

  expect(panelTabs().map(({ title }) => title)).toEqual(["current result"])
})

it("removes a stopped tab in network grace and presents the selected session when membership recovers", async () => {
  const fake = setup()
  const first = tab("first", "session-a", "first preview")
  const second = tab("second", "session-b", "second preview")
  fake.tabs.set(first.sessionId, [first])
  fake.tabs.set(second.sessionId, [second])
  const present = vi.fn<WorkbenchBridge["browserPresent"]>(async () => undefined)
  const activate = vi.fn<WorkbenchBridge["browserSetActiveSession"]>(async () => undefined)
  Object.assign(fake.bridge, { browserPresent: present, browserSetActiveSession: activate })
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  )
  const measure = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(10, 20, 640, 480))
  const bounds = { x: 10, y: 20, width: 640, height: 480, scale: 1 }
  try {
    await screen.render(fake.bridge, { sessionId: first.sessionId, membershipActive: true })
    await vi.waitFor(() => expect(present).toHaveBeenCalledWith(first.id, bounds, first.sessionId))

    await screen.render(fake.bridge, { sessionId: first.sessionId, membershipActive: false })
    fake.tabs.delete(first.sessionId)
    await fake.emit({ type: "browser-close", id: first.id, sessionId: first.sessionId })
    expect(panelTabs()).toEqual([])

    await screen.render(fake.bridge, { sessionId: second.sessionId, membershipActive: false })
    expect(panelTabs().map(({ title }) => title)).toEqual(["second preview"])
    expect(activate).toHaveBeenLastCalledWith(second.sessionId)
    await vi.waitFor(() =>
      expect(present).toHaveBeenLastCalledWith(second.id, null, second.sessionId),
    )
    expect(present).not.toHaveBeenCalledWith(second.id, bounds, second.sessionId)

    await screen.render(fake.bridge, { sessionId: second.sessionId, membershipActive: true })
    await vi.waitFor(() =>
      expect(present).toHaveBeenLastCalledWith(second.id, bounds, second.sessionId),
    )
    expect(panelTabs().map(({ title }) => title)).toEqual(["second preview"])
  } finally {
    measure.mockRestore()
  }
})
