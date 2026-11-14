// 负责验证侧栏项目右键菜单接到桌面桥：重命名只改显示名、在文件管理器中显示、从侧栏移除。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MembershipView } from "@pigclaude/contracts/membership"
import { DesktopApp } from "./app"
import { installPigcodeNative } from "./lib/pigcode-native"
import { chatAccount, typeAndSend } from "./test-support/chat-screen-harness"
import { fakeWorkbench, projectRoot, treeRow } from "./test-support/workbench-harness"
import type { SessionHostEvent } from "../../main/session/session-types"
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

/** 装一个最小桌面桥：最近工作区和内存里的工作台，项目操作记在 calls 里。 */
function installBridge(initial: string[] = ["/work/api", "/work/web"]) {
  let paths = initial
  let names: Record<string, string> = {}
  const calls: string[] = []
  let listener: ((event: SessionHostEvent) => void) | null = null
  const emit = (event: SessionHostEvent) => listener?.(event)
  window.pigclaude = {
    platform: "darwin",
    membership: {
      inspect: async () => activeMembership(),
      subscribe: () => () => undefined,
      withdraw: async () => activeMembership(),
      signOut: async () => activeMembership(),
    },
    claudeAccounts: {
      list: async () => [chatAccount("acc-work", "工作号", null)],
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
      apps: async () => [{ id: "ghostty", name: "Ghostty", kind: "terminal" }],
      openWith: async (path, appId) => {
        calls.push(`open ${path} ${appId}`)
      },
    },
    workbench: fakeWorkbench({ "README.md": "# demo\n" }).bridge,
    session: {
      start: async () => {
        setTimeout(() =>
          emit({
            type: "started",
            sessionId: "s-1",
            model: "claude-sonnet",
            tools: [],
            permissionMode: "default",
          }),
        )
        return { sessionId: "s-1" }
      },
      send: async () => {
        setTimeout(() => {
          emit({ type: "account-switched", from: null, to: "acc-work", reason: "initial" })
          emit({
            type: "result",
            subtype: "success",
            isError: false,
            durationMs: 10,
            numTurns: 1,
            stopReason: "end_turn",
            usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
          })
        })
      },
      cancel: async () => undefined,
      respondPermission: async () => undefined,
      setMode: async () => undefined,
      setModel: async () => undefined,
      stop: async () => undefined,
      models: async () => ({
        models: [{ id: "claude-sonnet", displayName: "Sonnet", description: "", isDefault: true }],
        cliError: null,
      }),
      status: async () => ({
        active: false,
        sessionId: null,
        model: null,
        permissionMode: "default",
        accountId: null,
        pendingPermissions: 0,
        turnId: null,
      }),
      subscribe: (next) => {
        listener = next
        return () => {
          listener = null
        }
      },
    },
  }
  installPigcodeNative(window)
  return { calls }
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.getAttribute("aria-label") === label,
  )
  if (!found) throw new Error(`没有按钮 ${label}`)
  return found
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

  it("shows the project's files in the workbench and opens the project in an installed app", async () => {
    const { calls } = installBridge(["/work/api", projectRoot])
    await act(async () => root.render(createElement(DesktopApp)))
    await flush()

    const files = projectRow("app")
      .closest(".proj-row")
      ?.querySelector<HTMLButtonElement>('button[aria-label="查看文件"]')
    if (!files) throw new Error("项目行没有查看文件")
    await act(async () => files.click())
    await flush()
    await flush()

    expect(container.querySelector(".right-panel-slot")?.hasAttribute("hidden")).toBe(false)
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain(
      "文件",
    )
    expect(treeRow("README.md")).toBeDefined()

    await act(async () => button("在 Ghostty 中打开").click())
    await flush()
    expect(calls).toEqual([`open ${projectRoot} ghostty`])
  })

  it("marks the finished session row completed with the badge of the account it ran on", async () => {
    installBridge()
    await act(async () => root.render(createElement(DesktopApp)))
    await flush()

    await typeAndSend(container, "检查依赖")
    await flush()
    await flush()

    const row = container.querySelector<HTMLElement>(".proj-sessions .sess")
    expect(row?.dataset.status).toBe("completed")
    expect(row?.querySelector(".agent-icon-badge")).not.toBeNull()
    expect(row?.querySelector(".sess-agent")?.getAttribute("title")).toBe("工作号")
  })
})
