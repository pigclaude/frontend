// 负责验证 CLI 导入后的账号能直接进入重新授权：App 和主窗口共用同一份账号列表，提交的是导入账号 id。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { ClaudeAccountView, ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { DesktopApp } from "./app"
import { initialMembershipView } from "./models/membership-view"
import { chooseSelect } from "./test-support/base-ui-select"

vi.mock("./hooks/use-appearance", () => ({
  useAppearance: () => ({
    resolved: "dark",
    settings: { smartPunctuation: false },
    update: () => undefined,
  }),
}))

type AuthorizeInput = import("../../main/claude/account-service-inputs").AuthorizeClaudeAccountInput

const fingerprint: ClaudeFingerprintView = {
  seed: "",
  brand: "Chrome",
  platform: "macos",
  lang: "en-US",
  timezone: "America/Chicago",
  canvasNoise: "",
  clientRectsNoise: "",
  brandVersion: "",
  platformVersion: "",
  acceptLang: "",
  resolution: "",
  customResolution: "",
  hardwareConcurrency: "",
  webrtcPolicy: "",
  disableSpoofing: [],
  colorDepth: "",
  deviceMemory: "",
  touchPoints: "",
  doNotTrack: "",
  mediaDevices: "",
  audioNoise: "",
  fontList: "",
  webglVendor: "",
  webglRenderer: "",
  unknownArgs: [],
}

const importedAccount: ClaudeAccountView = {
  id: "acc-imported",
  browserProfileId: "profile-imported",
  displayName: "CLI 账号",
  enabled: true,
  email: "cli@example.com",
  subscriptionType: "pro",
  needsReauth: false,
  credentialExpiresAt: Date.now() + 60_000,
  proxyId: null,
  fingerprint,
  createdAt: "2026-10-26T00:00:00.000Z",
  updatedAt: "2026-10-26T00:00:00.000Z",
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
  window.history.replaceState({}, "", "/?screen=accounts")
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  window.history.replaceState({}, "", "/")
  delete window.pigclaude
  vi.unstubAllGlobals()
})

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function button(name: string, scope: ParentNode = container): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  )
}

async function click(name: string, scope: ParentNode = container): Promise<void> {
  const target = button(name, scope)
  expect(target, name).toBeDefined()
  await act(async () => target?.click())
}

function dialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"]')
}

/** 装一个最小桌面桥：导入把账号加进列表，无 id 的授权会新建重复账号，用来抓回归。 */
function installBridge(): {
  authorized: AuthorizeInput[]
  accounts: () => ClaudeAccountView[]
} {
  let accounts: ClaudeAccountView[] = []
  const authorized: AuthorizeInput[] = []
  const authorize = vi.fn(async (input: AuthorizeInput) => {
    authorized.push(input)
    if (input.accountId === undefined) {
      const duplicate: ClaudeAccountView = { ...importedAccount, id: "acc-duplicate" }
      accounts = [...accounts, duplicate]
      return duplicate
    }
    return accounts.find((account) => account.id === input.accountId) ?? importedAccount
  })
  window.pigclaude = {
    platform: "darwin",
    browserProfiles: {
      list: async () => [
        {
          id: "profile-imported",
          name: "导入账号环境",
          proxyId: null,
          fingerprint,
          revision: 1,
          boundAccounts: accounts.map((account) => ({ id: account.id, name: account.displayName })),
          inUse: false,
          createdAt: "",
          updatedAt: "",
        },
      ],
      save: async () => {
        throw new Error("此用例不保存配置")
      },
      remove: async () => undefined,
      region: async () => ({
        ip: "1.1.1.1",
        countryCode: "US",
        timezone: "America/Chicago",
        locale: "en-US",
      }),
    },
    membership: {
      inspect: async () => activeMembership(),
      subscribe: () => () => undefined,
      withdraw: async () => activeMembership(),
      signOut: async () => activeMembership(),
    },
    claudeAccounts: {
      list: async () => accounts,
      authorize,
      cancelAuthorization: async () => undefined,
      update: async () => importedAccount,
      remove: async () => undefined,
      importFromClaudeCli: async () => {
        accounts = [importedAccount]
        return importedAccount
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
      list: async () => [],
      add: async (path) => [path],
      files: async () => [],
      names: async () => ({}),
      rename: async () => ({}),
      remove: async () => [],
      reveal: async () => undefined,
    },
  }
  return { authorized, accounts: () => accounts }
}

describe("reauthorizing an imported account", () => {
  it("submits the imported account id instead of creating a duplicate", async () => {
    const bridge = installBridge()
    await act(async () => root.render(createElement(DesktopApp)))
    await flush()

    await click("从 Claude CLI 导入")
    const picker = document.querySelector<HTMLElement>("#import-browser-profile")
    if (!picker) throw new Error("导入配置选择不存在")
    await chooseSelect(picker, "导入账号环境 · en-US · America/Chicago")
    await click("确认导入", dialog() ?? document.body)
    await flush()
    expect(container.textContent).toContain("已从 Claude CLI 导入账号")
    expect(bridge.accounts().map((account) => account.id)).toEqual(["acc-imported"])

    const row = [...container.querySelectorAll<HTMLButtonElement>("button.list-row")].find((item) =>
      item.textContent?.includes("CLI 账号"),
    )
    expect(row).toBeDefined()
    await act(async () => row?.click())
    await click("重新授权")
    expect(container.textContent).toContain("重新授权 Claude 账号")

    await click("下一步")
    await click("使用此配置")
    await click("检测环境并准备授权")
    await flush()

    expect(bridge.authorized).toHaveLength(1)
    expect(bridge.authorized[0]).toMatchObject({
      accountId: "acc-imported",
      displayName: "CLI 账号",
      browserProfileId: "profile-imported",
    })
    expect(bridge.accounts().map((account) => account.id)).toEqual(["acc-imported"])
  })
})
