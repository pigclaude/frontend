// 负责验证托盘页：显示真实会员名称/等级和账号摘要、需要重新授权的账号计数，不再出现 fixture 百分比。

// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { ClaudeAccountView } from "@pigclaude/contracts/claude-account"
import { TrayScreen, type TrayScreenProps } from "./tray-screen"

const membership: MembershipView = {
  startupPhase: "settled",
  revision: 3,
  state: "active",
  account: { userId: "u1", nickname: "林舟", email: "lin@example.com", avatar: "" },
  tier: { code: "max", name: "Max", level: 3 },
  membershipValidUntil: "2026-12-01T00:00:00.000Z",
  offlineValidUntil: null,
  lastVerifiedAt: "2026-10-21T00:00:00.000Z",
  nextVerificationAt: null,
  bindingEpoch: null,
  errorCode: null,
  serverReason: null,
  authorizationUrl: null,
}

const account = (id: string, displayName: string, needsReauth: boolean): ClaudeAccountView => ({
  id,
  displayName,
  enabled: true,
  email: null,
  subscriptionType: "max",
  needsReauth,
  credentialExpiresAt: null,
  exhaustedUntil: null,
  proxyId: "proxy-1",
  fingerprint: {
    seed: "123456",
    brand: "Chrome",
    platform: "macos",
    lang: "en-US",
    timezone: "America/Los_Angeles",
    canvasNoise: "1",
    clientRectsNoise: "1",
  },
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
})

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

async function render(overrides: Partial<TrayScreenProps> = {}): Promise<void> {
  const props: TrayScreenProps = {
    membership,
    accounts: [account("a1", "主力 Max", false), account("a2", "旧号 Pro", true)],
    onOpenAccounts: () => undefined,
    onOpenSettings: () => undefined,
    ...overrides,
  }
  await act(async () => root.render(createElement(TrayScreen, props)))
}

describe("tray screen", () => {
  it("shows the real membership and account summary", async () => {
    await render()

    expect(container.textContent).toContain("林舟")
    expect(container.textContent).toContain("Max")
    expect(container.textContent).toContain("主力 Max")
    expect(container.textContent).toContain("旧号 Pro")
    expect(container.textContent).toContain("需重新授权")
    expect(container.textContent).toContain("—")
    expect(container.textContent).not.toContain("62%")
  })

  it("opens the account page from the attention row", async () => {
    const onOpenAccounts = vi.fn()
    await render({ onOpenAccounts })

    const row = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("1 个账号需要处理"),
    )
    await act(async () => row?.click())

    expect(onOpenAccounts).toHaveBeenCalledTimes(1)
  })

  it("shows the signed out state without fake accounts", async () => {
    await render({
      membership: { ...membership, state: "signed_out", account: null, tier: null },
      accounts: [],
    })

    expect(container.textContent).toContain("未登录")
    expect(container.textContent).toContain("还没有 Claude 账号")
    expect(container.textContent).not.toContain("主力 Max")
  })

  it("never puts credentials into the page", async () => {
    await render()

    expect(container.innerHTML).not.toMatch(/accessToken|refreshToken|sk-ant-|Bearer /)
  })
})
