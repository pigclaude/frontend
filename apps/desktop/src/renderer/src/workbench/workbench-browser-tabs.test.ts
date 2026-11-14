// 验证主进程关闭一个会话的浏览器时，只移除该浏览器的工作台标签。
// @vitest-environment jsdom
import { expect, it, vi } from "vitest"
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
