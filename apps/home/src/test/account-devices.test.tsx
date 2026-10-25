// 负责验证设备管理页：电脑行的系统、版本、IP 和活跃排序，网页登录的当前浏览器与退出确认，以及核验后续接。
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AccountDevicesPage from "@/app/(app)/account/devices/page"
import { savePending } from "@/lib/pending-sensitive-operation"
import { localIso } from "./account-fixtures"

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  list: vi.fn(),
  revoke: vi.fn(),
  revokeOthers: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams(),
}))
vi.mock("next/navigation", () => ({
  usePathname: () => "/account/devices",
  useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
  useSearchParams: () => mocks.params,
}))
vi.mock("@/lib/api", async () => {
  const { createClient } = await import("@pigclaude/api/client")
  return {
    homeClient: createClient({ fetch: mocks.fetch }),
    homeApi: {
      user: { me: async () => ({ hasPassword: true }) },
      webSessions: { list: mocks.list, revoke: mocks.revoke, revokeOthers: mocks.revokeOthers },
    },
  }
})

const mac = "pcd_" + "a".repeat(64)
const win = "pcd_" + "b".repeat(64)
const bare = "pcd_" + "c".repeat(64)
let devices: unknown[] = []
function computer(overrides: Record<string, unknown>) {
  return {
    deviceId: mac,
    displayName: "林的 MacBook Pro",
    platform: "macos",
    status: "active",
    bindingEpoch: "7",
    firstAuthorizedAt: localIso(2026, 10, 1),
    lastSeenAt: localIso(2026, 10, 24, 11, 58),
    isCurrentDevice: null,
    osVersion: "macOS 15.4",
    appVersion: "1.3.0",
    lastIp: "112.64.12.8",
    ...overrides,
  }
}
function session(overrides: Record<string, unknown>) {
  return {
    id: "s-current",
    browser: "Chrome",
    os: "macOS",
    createdAt: localIso(2026, 10, 20),
    lastSeenAt: localIso(2026, 10, 24, 11, 59),
    createdIp: "112.64.12.8",
    lastIp: "112.64.12.8",
    isCurrent: true,
    ...overrides,
  }
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status })
}
function renderPage() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AccountDevicesPage />
    </QueryClientProvider>,
  )
}
function rowOf(text: string) {
  return screen.getByText(text).closest(".set-row") as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(2026, 9, 24, 12, 0))
  mocks.params = new URLSearchParams()
  devices = [
    computer({
      deviceId: win,
      displayName: "办公室台式机",
      platform: "windows",
      lastSeenAt: localIso(2026, 10, 21, 12),
      osVersion: "Windows 11",
      appVersion: "1.2.4",
      lastIp: "36.112.3.9",
    }),
    computer({}),
  ]
  mocks.list.mockResolvedValue([
    session({
      id: "s-old",
      browser: "Edge",
      os: "Windows",
      isCurrent: false,
      createdAt: localIso(2026, 10, 2),
      lastSeenAt: localIso(2026, 10, 12, 9),
      lastIp: "36.112.3.9",
    }),
    session({}),
    session({
      id: "s-phone",
      browser: "Safari",
      os: "iPhone",
      isCurrent: false,
      createdAt: localIso(2026, 10, 18),
      lastSeenAt: localIso(2026, 10, 23, 20),
      lastIp: "112.64.12.9",
    }),
  ])
  mocks.revoke.mockResolvedValue(undefined)
  mocks.revokeOthers.mockResolvedValue(undefined)
  mocks.fetch.mockReset().mockImplementation(async (url) => {
    if (String(url).startsWith("/v1/user/devices")) return json(devices)
    if (String(url) === "/v1/user/identities") return json([])
    if (String(url) === "/v1/session") return json({ csrf: "server-csrf" })
    if (String(url) === "/v1/auth/captcha")
      return json({ enabled: false, provider: "turnstile", siteKey: null, mode: "disabled" })
    return json({ type: "verified" })
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("account devices page", () => {
  it("lists computers with os, app version, ip and activity, newest first", async () => {
    renderPage()
    const group = (await screen.findByRole("heading", { name: "电脑 · 2 台" })).closest(
      "section",
    ) as HTMLElement
    const titles = within(group)
      .getAllByText(/MacBook|台式机/)
      .map((node) => node.textContent)
    expect(titles).toEqual(["林的 MacBook Pro", "办公室台式机"])
    expect(rowOf("林的 MacBook Pro").textContent).toContain(
      "正在使用 · macOS 15.4 · PigClaude 1.3.0 · 112.64.12.8",
    )
    expect(rowOf("办公室台式机").textContent).toContain(
      "3 天前活跃 · Windows 11 · PigClaude 1.2.4 · 36.112.3.9",
    )
    expect(within(rowOf("林的 MacBook Pro")).getByTitle("2026/10/24 11:58")).toBeTruthy()
  })

  it("omits missing metadata instead of printing placeholders", async () => {
    devices = [
      computer({
        deviceId: bare,
        displayName: "旧电脑",
        platform: "linux",
        lastSeenAt: null,
        osVersion: null,
        appVersion: null,
        lastIp: null,
      }),
      computer({ osVersion: null, lastIp: null }),
    ]
    renderPage()
    await screen.findByText("旧电脑")
    const desc = rowOf("旧电脑").querySelector(".set-row-desc")
    expect(desc).toBeNull()
    expect(rowOf("林的 MacBook Pro").textContent).toContain("正在使用 · PigClaude 1.3.0")
    expect(document.body.textContent).not.toMatch(/null|undefined|暂无|—/)
  })

  it("never shows device hashes or raw platform values", async () => {
    renderPage()
    await screen.findByText("林的 MacBook Pro")
    const text = document.body.textContent ?? ""
    expect(text).not.toContain(mac)
    expect(text).not.toContain("pcd_")
    expect(text).not.toMatch(/\bmacos\b|\bwindows\b/)
    expect(text).not.toContain("这台电脑")
  })

  it("shows an empty state when no computer is signed in", async () => {
    devices = []
    renderPage()
    expect(await screen.findByText("还没有在电脑上登录过 PigClaude")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "全部移除" })).toBeNull()
  })

  it("puts the current browser first with a badge and no sign-out button", async () => {
    renderPage()
    const group = (await screen.findByRole("heading", { name: "网页登录 · 3 个" })).closest(
      "section",
    ) as HTMLElement
    const titles = Array.from(group.querySelectorAll(".set-row-title")).map(
      (node) => node.textContent,
    )
    expect(titles).toEqual(["Chrome · macOS当前浏览器", "Safari · iPhone", "Edge · Windows"])
    const current = rowOf("Chrome · macOS")
    expect(within(current).queryByRole("button")).toBeNull()
    expect(current.textContent).toContain("正在使用 · 112.64.12.8 · 10 月 20 日登录")
    expect(rowOf("Safari · iPhone").textContent).toContain("昨天活跃")
    expect(rowOf("Edge · Windows").textContent).toContain(
      "12 天前活跃 · 36.112.3.9 · 10 月 2 日登录",
    )
  })

  it("always shows the current browser as in use even if the server lags", async () => {
    mocks.list.mockResolvedValue([session({ lastSeenAt: localIso(2026, 10, 21, 9) })])
    renderPage()
    await screen.findByRole("heading", { name: "网页登录 · 1 个" })
    expect(rowOf("Chrome · macOS").textContent).toContain("正在使用 · 112.64.12.8")
  })

  it("signs out another browser after confirmation and refreshes", async () => {
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "退出 Safari · iPhone" }))
    const dialog = await screen.findByRole("dialog", { name: "退出 Safari · iPhone？" })
    expect(within(dialog).getByText("退出后，那个浏览器需要重新登录。")).toBeTruthy()
    expect(mocks.revoke).not.toHaveBeenCalled()
    mocks.list.mockResolvedValue([session({})])
    fireEvent.click(within(dialog).getByRole("button", { name: "退出" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(mocks.revoke).toHaveBeenCalledWith("s-phone", expect.any(Function))
    expect(await screen.findByRole("heading", { name: "网页登录 · 1 个" })).toBeTruthy()
  })

  it("signs out every other browser at once", async () => {
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "退出其他所有网页" }))
    const dialog = await screen.findByRole("dialog", { name: "退出其他所有网页？" })
    fireEvent.click(within(dialog).getByRole("button", { name: "退出" }))
    await waitFor(() => expect(mocks.revokeOthers).toHaveBeenCalledWith(expect.any(Function)))
    expect(mocks.revoke).not.toHaveBeenCalled()
  })

  it("keeps the dialog open with a message when signing out fails", async () => {
    mocks.revoke.mockRejectedValue(new Error("network"))
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "退出 Edge · Windows" }))
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "退出" }))
    expect((await screen.findByRole("alert")).textContent).toBe("退出失败，请刷新列表后重试")
    expect(screen.getByRole("dialog")).toBeTruthy()
  })

  it("hides 退出其他所有网页 when only the current session exists", async () => {
    mocks.list.mockResolvedValue([session({})])
    renderPage()
    expect(await screen.findByRole("heading", { name: "网页登录 · 1 个" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "退出其他所有网页" })).toBeNull()
  })

  it("rename and remove still go through the existing recent-auth flow", async () => {
    renderPage()
    fireEvent.keyDown(await screen.findByRole("button", { name: "更多操作：林的 MacBook Pro" }), {
      key: "Enter",
    })
    fireEvent.click(await screen.findByRole("menuitem", { name: "移除这台电脑" }))
    const dialog = await screen.findByRole("dialog", { name: "近期身份核验" })
    expect(within(dialog).getByText(/移除这台电脑前需要确认是你本人/)).toBeTruthy()
    expect(within(dialog).getByLabelText("当前密码")).toBeTruthy()
  })

  it("resumes removing the same computer after provider verification", async () => {
    savePending({ operation: "revoke_device", device_id: mac, expected_binding_epoch: "7" })
    mocks.params = new URLSearchParams("identityResult=verified")
    renderPage()
    expect(await screen.findByRole("dialog", { name: "近期身份核验" })).toBeTruthy()
    expect(mocks.replace).toHaveBeenCalledWith("/account/devices")
  })

  it("does not resume when the computer's binding changed meanwhile", async () => {
    savePending({ operation: "revoke_device", device_id: mac, expected_binding_epoch: "6" })
    mocks.params = new URLSearchParams("identityResult=verified")
    renderPage()
    await screen.findByText("林的 MacBook Pro")
    await waitFor(() => expect(mocks.replace).toHaveBeenCalled())
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
