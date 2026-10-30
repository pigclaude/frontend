// 负责验证账号页：真实空状态、需重新授权、停用和冷却账号可识别并能启用/停用、删除要确认、错误可见且页面不出现凭据。

// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  ClaudeAccountView,
  ClaudeFingerprintView,
  ProxyView,
} from "@pigclaude/contracts/claude-account"
import { toPoolAccount, toPoolProxy } from "../models/claude-account-view"
import { normalizeFingerprintForm } from "../models/fingerprint-form"
import { fillFingerprintField } from "../test-support/fingerprint-input"
import { AccountsScreen, type AccountsScreenProps } from "./accounts-screen"

const fingerprint: ClaudeFingerprintView = {
  seed: "123456",
  brand: "Chrome",
  platform: "macos",
  lang: "en-US",
  timezone: "America/Los_Angeles",
  canvasNoise: "1",
  clientRectsNoise: "1",
}

const proxy: ProxyView = {
  id: "la-01",
  name: "LA-01",
  url: "http://user:***@127.0.0.1:18080",
  lastTest: { ok: true, ip: "203.0.113.42", latencyMs: 186, testedAt: "2026-10-21T00:00:00.000Z" },
}

const secondProxy: ProxyView = {
  id: "sjc-02",
  name: "SJC-02",
  url: "http://user:***@127.0.0.1:18081",
  lastTest: { ok: true, ip: "198.51.100.17", latencyMs: 172, testedAt: "2026-10-21T00:00:00.000Z" },
}

const ready: ClaudeAccountView = {
  id: "acc-ready",
  displayName: "工作 Max",
  enabled: true,
  email: "work•••@example.com",
  subscriptionType: "max",
  needsReauth: false,
  credentialExpiresAt: 4_102_444_800_000,
  exhaustedUntil: null,
  proxyId: "la-01",
  fingerprint,
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
}

const expired: ClaudeAccountView = {
  ...ready,
  id: "acc-expired",
  displayName: "旧号 Pro",
  subscriptionType: "pro",
  needsReauth: true,
  credentialExpiresAt: null,
}

const disabled: ClaudeAccountView = {
  ...ready,
  id: "acc-disabled",
  displayName: "停用账号",
  enabled: false,
}

const cooling: ClaudeAccountView = {
  ...ready,
  id: "acc-cooling",
  displayName: "冷却账号",
  exhaustedUntil: "2026-10-21T03:20:00.000Z",
}

const direct: ClaudeAccountView = {
  ...ready,
  id: "acc-direct",
  displayName: "直连 Pro",
  subscriptionType: "pro",
  proxyId: null,
}

const dangling: ClaudeAccountView = {
  ...ready,
  id: "acc-dangling",
  displayName: "悬空 Pro",
  subscriptionType: "pro",
  proxyId: "deleted-proxy",
}

const boundToSecond: ClaudeAccountView = {
  ...ready,
  id: "acc-sjc",
  displayName: "圣何塞 Pro",
  proxyId: "sjc-02",
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-21T01:00:00.000Z"))
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  window.localStorage.clear()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function render(
  views: ClaudeAccountView[],
  props: Partial<AccountsScreenProps> = {},
  proxyViews: ProxyView[] = [proxy],
): Promise<void> {
  await act(async () =>
    root.render(
      createElement(AccountsScreen, {
        accounts: views.map((view) => toPoolAccount(view, proxyViews)),
        proxies: proxyViews.map((item) => toPoolProxy(item, views)),
        onOpenAuthorize: () => undefined,
        onRemove: () => undefined,
        onUpdate: () => undefined,
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

async function clickButton(target: HTMLButtonElement | undefined, name: string): Promise<void> {
  expect(target, name).toBeDefined()
  await act(async () => target?.click())
}

async function openAccount(name: string): Promise<void> {
  const row = [...container.querySelectorAll("button.item")].find((item) =>
    item.textContent?.includes(name),
  )
  await clickButton(row as HTMLButtonElement | undefined, name)
}

function dialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"]')
}

function dialogChoice(text: string): HTMLButtonElement | undefined {
  return [...(dialog()?.querySelectorAll("button") ?? [])].find((candidate) =>
    candidate.textContent?.includes(text),
  )
}

async function typeDialog(selector: string, value: string): Promise<void> {
  await fillFingerprintField(document.body, selector.replace(/^#/, ""), value)
}

async function clickDialog(selector: string): Promise<void> {
  const element = document.body.querySelector<HTMLButtonElement>(selector)
  expect(element, selector).not.toBeNull()
  await act(async () => element?.click())
}

describe("accounts screen", () => {
  it("shows an empty state and the add button when there is no account", async () => {
    const onOpenAuthorize = vi.fn()
    await render([], { onOpenAuthorize })

    expect(container.textContent).toContain("还没有 Claude 账号")
    await clickButton(button("添加账号"), "添加账号")
    expect(onOpenAuthorize).toHaveBeenCalledTimes(1)
  })

  it("lists reauthorization, disabled and cooling accounts apart from the switch order", async () => {
    await render([ready, expired, disabled, cooling])

    const sections = [...container.querySelectorAll("section.section")]
    expect(sections[0]?.textContent).toContain("需要处理")
    expect(sections[0]?.textContent).toContain("旧号 Pro")
    expect(sections[0]?.textContent).toContain("需重新授权")
    expect(sections[0]?.textContent).toContain("停用账号")
    expect(sections[0]?.textContent).toContain("已停用")
    expect(sections[0]?.textContent).toContain("冷却账号")
    expect(sections[0]?.textContent).toContain("冷却中")
    expect(sections[1]?.textContent).toContain("工作 Max")
    expect(sections[1]?.textContent).not.toContain("旧号 Pro")
  })

  it("shows a direct account as the system network in the list and detail", async () => {
    await render([direct])

    expect(container.textContent).toContain("系统网络（直连）")
    await openAccount("直连 Pro")
    expect(container.textContent).toContain("系统网络（直连）")
    expect(container.textContent).toContain("登录与对话使用本机网络，不走代理")
    expect(container.textContent).not.toContain("未绑定代理")
    expect(container.textContent).not.toContain("需要绑定")

    await clickButton(button("编辑"), "编辑")
    expect(dialog()?.textContent).toContain("保存后下次重新授权使用同一份指纹")
    expect(dialog()?.textContent).toContain("身份与定位")
    expect(dialog()?.textContent).toContain("隐私与兼容")
  })

  it("shows the grouped fingerprint summary and saves the complete edited fingerprint", async () => {
    const onUpdate = vi.fn()
    await render([ready], { onUpdate })
    await openAccount("工作 Max")

    // 详情页按设置分组展示完整指纹，而不只是种子。
    expect(container.textContent).toContain("身份与定位")
    expect(container.textContent).toContain("设备与网络")
    expect(container.textContent).toContain("隐私与兼容")
    expect(container.textContent).toContain("开启")

    await clickButton(button("编辑"), "编辑")
    await typeDialog("#fingerprint-dialog-seed", "654321")
    await typeDialog("#fingerprint-dialog-timezone", "Asia/Tokyo")
    await clickDialog("#fingerprint-dialog-group-compat")
    await clickDialog("#fingerprint-dialog-canvasNoise-0")
    await clickButton(button("保存", dialog() ?? document.body), "保存")

    expect(onUpdate).toHaveBeenCalledWith({
      accountId: "acc-ready",
      fingerprint: {
        ...normalizeFingerprintForm(fingerprint),
        seed: "654321",
        timezone: "Asia/Tokyo",
        canvasNoise: "0",
      },
    })
  })

  it("keeps stored raw arguments unchanged when editing another fingerprint field", async () => {
    const onUpdate = vi.fn()
    const unknownArgs = ["\u00a0--user-data-dir=/synthetic/profile", " --load-extension=/x ", ""]
    const account = { ...ready, fingerprint: { ...fingerprint, unknownArgs } }
    await render([account], { onUpdate })
    await openAccount("工作 Max")
    await clickButton(button("编辑"), "编辑")
    await typeDialog("#fingerprint-dialog-seed", "654321")
    await clickButton(button("保存", dialog() ?? document.body), "保存")

    expect(onUpdate).toHaveBeenCalledWith({
      accountId: "acc-ready",
      fingerprint: expect.objectContaining({ seed: "654321", unknownArgs }),
    })
  })

  it("removes a conflicting argument without splitting a different multiline argument", async () => {
    const onUpdate = vi.fn()
    const multiline = "--custom=a\n--load-extension=/synthetic/extension"
    const unknownArgs = [multiline, "--profile-directory=..", ""]
    await render([{ ...ready, fingerprint: { ...fingerprint, unknownArgs } }], { onUpdate })
    await openAccount("工作 Max")
    await clickButton(button("编辑"), "编辑")
    await clickDialog("#fingerprint-dialog-group-advanced")
    await clickDialog('[aria-label="删除原始参数 2"]')
    await clickButton(button("保存", dialog() ?? document.body), "保存")

    expect(onUpdate).toHaveBeenCalledWith({
      accountId: "acc-ready",
      fingerprint: expect.objectContaining({ unknownArgs: [multiline, ""] }),
    })
  })

  it("unbinds a bound account from the network dialog and keeps the choice on re-render", async () => {
    const onUpdate = vi.fn()
    await render([ready], { onUpdate })
    await openAccount("工作 Max")
    await clickButton(button("设置"), "设置")

    expect(dialog()?.textContent).toContain("不使用代理（系统网络直连）")
    await clickButton(dialogChoice("不使用代理（系统网络直连）"), "不使用代理")

    // 父组件重渲染会传新的 proxies 数组；弹层不能因此重置成账号原来的代理。
    await render([ready], { onUpdate })
    expect(dialog()?.querySelector("button.choice.is-selected")?.textContent).toContain(
      "不使用代理",
    )
    await clickButton(button("保存", dialog() ?? document.body), "保存")

    expect(onUpdate).toHaveBeenCalledWith({ accountId: "acc-ready", proxyId: null })
  })

  it("preselects the account's current proxy when opening the network dialog", async () => {
    const onUpdate = vi.fn()
    await render([boundToSecond], { onUpdate }, [proxy, secondProxy])
    await openAccount("圣何塞 Pro")
    await clickButton(button("设置"), "设置")

    expect(dialog()?.querySelector("button.choice.is-selected")?.textContent).toContain("SJC-02")
    await clickButton(button("保存", dialog() ?? document.body), "保存")

    expect(onUpdate).toHaveBeenCalledWith({ accountId: "acc-sjc", proxyId: "sjc-02" })
  })

  it("does not silently turn a dangling proxy binding into a direct account", async () => {
    const onUpdate = vi.fn()
    await render([dangling], { onUpdate })
    await openAccount("悬空 Pro")
    await clickButton(button("设置"), "设置")

    expect(dialog()?.textContent).toContain("原代理已不存在，请重新选择网络出口")
    expect(dialog()?.querySelector("button.choice.is-selected")).toBeNull()
    expect(button("保存", dialog() ?? document.body)?.disabled).toBe(true)

    await clickButton(dialogChoice("不使用代理（系统网络直连）"), "不使用代理")
    expect(button("保存", dialog() ?? document.body)?.disabled).toBe(false)
    await clickButton(button("保存", dialog() ?? document.body), "保存")

    expect(onUpdate).toHaveBeenCalledWith({ accountId: "acc-dangling", proxyId: null })
  })

  it("saves the system network for a direct account even when there are no proxies", async () => {
    const onUpdate = vi.fn()
    await render([direct], { onUpdate, proxies: [] })
    await openAccount("直连 Pro")
    await clickButton(button("设置"), "设置")

    expect(dialog()?.textContent).toContain("还没有代理")
    await clickButton(button("保存", dialog() ?? document.body), "保存")

    expect(onUpdate).toHaveBeenCalledWith({ accountId: "acc-direct", proxyId: null })
  })

  it("enables a disabled account from its detail page", async () => {
    const onUpdate = vi.fn()
    await render([disabled], { onUpdate })

    await openAccount("停用账号")
    await clickButton(button("启用"), "启用")

    expect(onUpdate).toHaveBeenCalledWith({ accountId: "acc-disabled", enabled: true })
  })

  it("removes an account only after the delete is confirmed", async () => {
    const onRemove = vi.fn()
    await render([ready], { onRemove })
    await openAccount("工作 Max")
    await clickButton(button("删除"), "删除")

    expect(dialog()?.textContent).toContain("删除「工作 Max」？")
    await clickButton(button("取消", dialog() ?? document.body), "取消")
    expect(onRemove).not.toHaveBeenCalled()

    await clickButton(button("删除"), "删除")
    await clickButton(button("删除", dialog() ?? document.body), "确认删除")
    expect(onRemove).toHaveBeenCalledWith("acc-ready")
  })

  it("keeps the account and shows the error when the browser profile cannot be deleted", async () => {
    let failure: string | null = null
    const onRemove = vi.fn(() => {
      failure = "删除浏览器配置目录失败"
    })
    await render([ready], { onRemove })
    await openAccount("工作 Max")
    await clickButton(button("删除"), "删除")
    await clickButton(button("删除", dialog() ?? document.body), "确认删除")
    expect(onRemove).toHaveBeenCalledTimes(1)

    await render([ready], { onRemove, error: failure })
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("删除浏览器配置目录失败")
    expect(container.textContent).toContain("工作 Max")
  })

  it("imports from Claude CLI only after the confirmation dialog", async () => {
    const onImportFromClaudeCli = vi.fn(async () => true)
    await render([], { onImportFromClaudeCli })

    await clickButton(button("从 Claude CLI 导入"), "从 Claude CLI 导入")
    const copy = dialog()?.textContent ?? ""
    expect(copy).toContain("读取并复制 macOS 钥匙串中的 Claude CLI OAuth")
    expect(copy).toContain("原 CLI 凭据不会删除")
    expect(copy).toContain("两个应用共享同一登录会话")
    expect(copy).toContain("两个应用共用同一个 refresh token")
    expect(copy).toContain("任一方刷新都可能让另一方需要重新登录或重新导入")
    expect(copy).toContain("security")
    expect(copy).toContain("系统网络和默认指纹")
    expect(onImportFromClaudeCli).not.toHaveBeenCalled()

    await clickButton(button("取消", dialog() ?? document.body), "取消")
    expect(onImportFromClaudeCli).not.toHaveBeenCalled()

    await clickButton(button("从 Claude CLI 导入"), "从 Claude CLI 导入")
    await clickButton(button("确认导入", dialog() ?? document.body), "确认导入")
    expect(onImportFromClaudeCli).toHaveBeenCalledTimes(1)
    await act(async () => undefined)
    expect(container.querySelector('[role="status"]')?.textContent).toBe("已从 Claude CLI 导入账号")
  })

  it("keeps the import button busy and ignores repeated clicks while importing", async () => {
    let resolveImport: (ok: boolean) => void = () => undefined
    const onImportFromClaudeCli = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveImport = resolve
        }),
    )
    await render([], { onImportFromClaudeCli })

    await clickButton(button("从 Claude CLI 导入"), "从 Claude CLI 导入")
    await clickButton(button("确认导入", dialog() ?? document.body), "确认导入")

    const busy = button("正在导入…")
    expect(busy?.disabled).toBe(true)
    await clickButton(busy, "正在导入…")
    expect(dialog()).toBeNull()
    expect(onImportFromClaudeCli).toHaveBeenCalledTimes(1)

    await act(async () => resolveImport(true))
    expect(container.querySelector('[role="status"]')?.textContent).toBe("已从 Claude CLI 导入账号")
    expect(button("从 Claude CLI 导入")?.disabled).toBe(false)
  })

  it("shows the fixed error and no success note when the CLI import fails", async () => {
    const onImportFromClaudeCli = vi.fn(async () => false)
    await render([], { onImportFromClaudeCli })
    await clickButton(button("从 Claude CLI 导入"), "从 Claude CLI 导入")
    await clickButton(button("确认导入", dialog() ?? document.body), "确认导入")
    await act(async () => undefined)
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(button("从 Claude CLI 导入")?.disabled).toBe(false)
    expect(button("从 Claude CLI 导入")?.getAttribute("aria-busy")).toBe("false")

    await render([], {
      onImportFromClaudeCli,
      error: "Claude CLI 凭据已过期，请先在 Claude CLI 中刷新",
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Claude CLI 凭据已过期，请先在 Claude CLI 中刷新",
    )
  })

  it("never puts credentials into the page or localStorage", async () => {
    await render([ready, expired])
    await openAccount("工作 Max")

    const page = `${container.innerHTML}${JSON.stringify({ ...window.localStorage })}`
    expect(page).not.toMatch(/accessToken|refreshToken|sk-ant-|Bearer /)
    expect(container.textContent).toContain("已保存")
  })
})
