// 负责整窗页面测试的公共夹具：每个测试一个挂载点，以及只在内存里的桌面桥（会员、号池、最近工作区、
// 项目操作、本机应用、工作台、新会话默认设置和一个跑完一轮就结束的假会话）。
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, vi } from "vitest"
import type { MembershipView } from "@pigclaude/contracts/membership"
import { DesktopApp } from "../app"
import { installPigcodeNative } from "../lib/pigcode-native"
import { initialMembershipView } from "../models/membership-view"
import { chatAccount } from "./chat-screen-harness"
import { fakeWorkbench } from "./workbench-harness"
import { resetSessionDefaultsForTest } from "../hooks/use-session-defaults"
import type {
  SessionEnvelope,
  SessionHostEvent,
  SessionStartInput,
} from "../../../main/session/session-types"
import { builtinSessionDefaults, type SessionDefaults } from "../../../session-defaults-contract"

/** 整窗挂载点；只在测试运行期间可用。 */
export type DesktopAppRoot = { readonly container: HTMLDivElement; readonly root: Root }

/** 每个测试前在新会话页挂一个新根节点，测试后卸载并清掉桌面桥。 */
export function desktopAppRoot(): DesktopAppRoot {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
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
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root?.unmount())
    host?.remove()
    window.history.replaceState({}, "", "/")
    delete window.pigclaude
    delete window.pigcodeNative
    resetSessionDefaultsForTest()
    vi.unstubAllGlobals()
  })
  return {
    get container() {
      if (host === null) throw new Error("挂载点只在测试运行期间可用")
      return host
    },
    get root() {
      if (root === null) throw new Error("挂载点只在测试运行期间可用")
      return root
    },
  }
}

/** 让出一轮计时器，等异步读取落定。 */
export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function activeMembership(): MembershipView {
  return {
    ...initialMembershipView(),
    startupPhase: "settled",
    revision: 1,
    state: "active",
    account: { userId: "u1", nickname: "林舟", email: "lin@example.com", avatar: "" },
  }
}

/** 装一个内存里的桌面桥并安装 window.pigcodeNative；项目操作记在 calls，启动会话的参数记在 starts。 */
export function installFakeDesktopBridge(
  initial: string[] = ["/work/api", "/work/web"],
  initialDefaults: SessionDefaults = builtinSessionDefaults,
) {
  let paths = initial
  let names: Record<string, string> = {}
  let defaults = initialDefaults
  const calls: string[] = []
  const starts: SessionStartInput[] = []
  let listener: ((envelope: SessionEnvelope) => void) | null = null
  let seq = 0
  const emit = (event: SessionHostEvent) =>
    listener?.({
      version: 1,
      sessionId: "s-1",
      seq: (seq += 1),
      at: new Date().toISOString(),
      event,
    })
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
    sessionDefaults: {
      get: async () => defaults,
      set: async (patch) => (defaults = { ...defaults, ...patch }),
    },
    session: {
      start: async (input) => {
        starts.push(input)
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
          emit({ type: "turn-started", turnId: "turn-1" })
          emit({
            type: "result",
            subtype: "success",
            isError: false,
            durationMs: 10,
            numTurns: 1,
            stopReason: "end_turn",
            usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
          })
          emit({ type: "turn-ended", turnId: "turn-1", status: "completed", errorCode: null })
        })
      },
      cancel: async () => undefined,
      respondPermission: async () => undefined,
      answerQuestion: async () => undefined,
      setMode: async () => undefined,
      setModel: async () => undefined,
      stop: async () => undefined,
      events: async () => [],
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
        pendingQuestions: 0,
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
  return { calls, starts }
}

/** 装上内存桌面桥后在挂载点里渲染整窗，等首轮读取落定；返回桌面桥记下的项目操作和启动参数。 */
export async function renderDesktopApp(
  app: DesktopAppRoot,
  paths?: string[],
  defaults?: SessionDefaults,
): Promise<ReturnType<typeof installFakeDesktopBridge>> {
  const bridge = installFakeDesktopBridge(paths, defaults)
  await act(async () => app.root.render(createElement(DesktopApp)))
  await flush()
  return bridge
}
