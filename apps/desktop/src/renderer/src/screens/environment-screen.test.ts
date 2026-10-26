// 负责验证环境页：用真实会话状态、模型探针、账号和代理列表展示检查结果，失败有可读原因，且不显示 token 或代理地址。

// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ClaudeAccountView, EgressView, ProxyView } from "@pigclaude/contracts/claude-account"
import type { ClaudeModel, SessionStatusView } from "../../../main/session/session-types"
import { EnvironmentScreen, type EnvironmentScreenProps } from "./environment-screen"

const proxy: ProxyView = {
  id: "la-01",
  name: "LA-01",
  url: "http://user:***@127.0.0.1:18080",
  lastTest: { ok: true, ip: "203.0.113.42", latencyMs: 186, testedAt: "2026-10-21T00:00:00.000Z" },
}

const account: ClaudeAccountView = {
  id: "acc-1",
  displayName: "主力 Max",
  enabled: true,
  email: null,
  subscriptionType: "max",
  needsReauth: false,
  credentialExpiresAt: 1_760_000_000_000,
  exhaustedUntil: null,
  proxyId: "la-01",
  fingerprint: {
    seed: "123456",
    brand: "Chrome",
    platform: "macos",
    lang: "en-US",
    timezone: "America/Los_Angeles",
    canvasNoise: true,
    clientRectsNoise: true,
  },
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
}

const directAccount: ClaudeAccountView = {
  ...account,
  id: "acc-direct",
  displayName: "直连 Max",
  proxyId: null,
}

const models: ClaudeModel[] = [
  { id: "claude-sonnet", displayName: "Sonnet", description: "", isDefault: true },
  { id: "claude-opus", displayName: "Opus", description: "", isDefault: false },
]

const status: SessionStatusView = {
  active: true,
  sessionId: "session-1",
  model: "claude-sonnet",
  permissionMode: "default",
  accountId: "acc-1",
  pendingPermissions: 1,
  turnId: "turn-1",
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

async function render(overrides: Partial<EnvironmentScreenProps> = {}): Promise<void> {
  const props: EnvironmentScreenProps = {
    accounts: [account],
    proxies: [proxy],
    status,
    models,
    modelsLoading: false,
    modelsError: null,
    onLoadModels: () => undefined,
    onCancelModels: () => undefined,
    onRecheck: () => undefined,
    onCheckEgress: vi.fn(async (): Promise<EgressView> => ({ ok: true, ip: "203.0.113.42" })),
    ...overrides,
  }
  await act(async () => root.render(createElement(EnvironmentScreen, props)))
}

function button(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  )
}

describe("environment screen", () => {
  it("shows the live session, CLI models, account and proxy state", async () => {
    await render()

    expect(container.textContent).toContain("会话运行中")
    expect(container.textContent).toContain("claude-sonnet")
    expect(container.textContent).toContain("可用 · 2 个模型")
    expect(container.textContent).toContain("1 个账号 · 1 个可用")
    expect(container.textContent).toContain("LA-01")
    expect(container.textContent).toContain("203.0.113.42")
  })

  it("counts a direct account as available and treats the system network as normal", async () => {
    await render({ accounts: [directAccount], proxies: [] })

    expect(container.textContent).toContain("1 个账号 · 1 个可用")
    expect(container.textContent).toContain("系统网络（直连）")
    expect(container.textContent).toContain("未绑定代理，无需检测")
    expect(container.textContent).not.toContain("没有代理")
    expect(button("检测出口")?.disabled).toBe(true)
    expect(container.querySelectorAll(".status.bad")).toHaveLength(0)
  })

  it("reports a missing daemon or CLI with a readable reason", async () => {
    await render({
      status: { ...status, active: false, sessionId: null, model: null, turnId: null },
      models: [],
      modelsError: "本机中继尚未就绪",
      modelsLoading: false,
    })

    expect(container.textContent).toContain("没有活动会话")
    expect(container.textContent).toContain("本机中继尚未就绪")
    expect(container.textContent).toContain("没有可用的模型")
  })

  it("shows a loading probe and an empty account state", async () => {
    await render({ accounts: [], models: [], modelsLoading: true })

    expect(container.textContent).toContain("检测中")
    expect(container.textContent).toContain("没有可用的 Claude 账号")
  })

  it("checks the selected proxy egress and shows the result", async () => {
    const onCheckEgress = vi.fn(async (): Promise<EgressView> => ({
      ok: false,
      reason: "proxy",
      message: "代理不可用",
    }))
    await render({ onCheckEgress })

    await act(async () => button("检测出口")?.click())

    expect(onCheckEgress).toHaveBeenCalledWith("la-01")
    expect(container.textContent).toContain("代理不可用")
  })

  it("never renders tokens, proxy addresses or environment variables", async () => {
    await render()
    await act(async () => button("检测出口")?.click())

    const page = container.innerHTML
    expect(page).not.toMatch(/accessToken|refreshToken|sk-ant-|Bearer /)
    expect(page).not.toContain("127.0.0.1:1808")
    expect(page).not.toContain("CLAUDE_CODE")
  })
})
