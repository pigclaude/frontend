// 负责验证侧栏项目右键菜单接到桌面桥：重命名只改显示名、在文件管理器中显示、从侧栏移除。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MembershipView } from "@pigclaude/contracts/membership"
import { DesktopApp } from "./app"
import { installPigcodeNative } from "./lib/pigcode-native"
import { initialMembershipView } from "./models/membership-view"

vi.mock("./hooks/use-appearance", () => ({
  useAppearance: () => ({
    resolved: "dark",
    settings: { smartPunctuation: false },
    update: () => undefined,
  }),
}))

function activeMembership(): MembershipView {
  return {
    ...initialMembershipView(),
    startupPhase: "settled",
    revision: 1,
    state: "active",
    account: { userId: "u1", nickname: "林舟", email: "lin@example.com", avatar: "" },
  }
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    media: "",
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }))
  window.history.replaceState({}, "", "/?screen=chat-new")
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  window.history.replaceState({}, "", "/")
  delete window.pigclaude
  delete window.pigcodeNative
  vi.unstubAllGlobals()
})

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** 装一个最小桌面桥：两个最近工作区，项目操作记在 calls 里。 */
function installBridge() {
  let paths = ["/work/api", "/work/web"]
  let names: Record<string, string> = {}
  const calls: string[] = []
  window.pigclaude = {
    platform: "darwin",
    membership: {
      inspect: async () => activeMembership(),
      subscribe: () => () => undefined,
      withdraw: async () => activeMembership(),
      signOut: async () => activeMembership(),
    },
    claudeAccounts: {
      list: async () => [],
      authorize: async () => {
        throw new Error("not used")
      },
      cancelAuthorization: async () => undefined,
      update: async () => {
        throw new Error("not used")
      },
      remove: async () => undefined,
      importFromClaudeCli: async () => {
        throw new Error("not used")
      },
      subscribe: () => () => undefined,
    },
    proxies: {
      list: async () => [],
      save: async () => {
        throw new Error("not used")
      },
      remove: async () => undefined,
      test: async () => {
        throw new Error("not used")
      },
    },
    egress: { check: async () => ({ ok: true, ip: "203.0.113.42" }) },
    workspaces: {
      list: async () => paths,
      add: async (path) => (paths = [path, ...paths.filter((item) => item !== path)]),
      files: async () => [],
      names: async () => names,
      rename: async (path, name) => {
        calls.push(`rename ${path} ${name}`)
        names = { ...names, [path]: name }
        return names
      },
      remove: async (path) => {
        calls.push(`remove ${path}`)
        paths = paths.filter((item) => item !== path)
        return paths
      },
      reveal: async (path) => {
        calls.push(`reveal ${path}`)
      },
    },
  }
  installPigcodeNative(window)
  return { calls }
}

function projectRow(name: string): HTMLElement {
  const row = [...container.querySelectorAll<HTMLElement>("button.proj")].find(
    (button) => button.textContent?.trim() === name,
  )
  if (!row) throw new Error(`没有项目 ${name}`)
  return row
}

async function chooseFromMenu(name: string, item: string): Promise<void> {
  await act(async () => {
    projectRow(name).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))
  })
  await flush()
  const entry = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent?.trim() === item,
  )
  if (!entry) throw new Error(`菜单里没有 ${item}`)
  await act(async () => entry.click())
  await flush()
}

describe("sidebar project actions", () => {
  it("renames, reveals and removes a project through the desktop bridge", async () => {
    const { calls } = installBridge()
    const user = userEvent.setup()
    await act(async () => root.render(createElement(DesktopApp)))
    await flush()

    await chooseFromMenu("api", "重命名")
    const input = container.querySelector<HTMLInputElement>('input[aria-label="项目名称"]')
    if (!input) throw new Error("没有改名输入框")
    await user.clear(input)
    await user.type(input, "后端{Enter}")
    await flush()
    expect(projectRow("后端")).toBeDefined()

    await chooseFromMenu("后端", "在访达中打开")
    await chooseFromMenu("web", "从侧栏移除")

    expect(calls).toEqual(["rename /work/api 后端", "reveal /work/api", "remove /work/web"])
    expect(() => projectRow("web")).toThrow()
  })
})
