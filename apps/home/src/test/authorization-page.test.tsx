// 负责验证新中央设备审批入口的失效、错误重试、原始接续及重复提交门禁。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { InteractionPanel } from "@/components/identity/interaction-panel"
import { identityNavigation } from "@/lib/identity-api"
import { interaction, json } from "./identity-fixture"
const mocks = vi.hoisted(() => ({ params: new URLSearchParams(), fetch: vi.fn<typeof fetch>() }))
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.params }))
function deviceInteraction() {
  return interaction({
    clientId: "pigclaude-desktop",
    scopes: ["user:read", "device:revoke"],
    phase: "device_approval",
    device: {
      deviceId: `pcd_${"a".repeat(64)}`,
      name: "我的 Mac",
      platform: "macos",
      status: "active",
      bindingEpoch: "9007199254740993",
    },
  })
}
beforeEach(() => {
  mocks.params = new URLSearchParams(
    "interactionId=interaction-1&realm=User&state=untrusted-query-state",
  )
  mocks.fetch.mockImplementation(async () => json(deviceInteraction()))
  vi.stubGlobal("fetch", mocks.fetch)
  vi.spyOn(identityNavigation, "assign").mockImplementation(() => undefined)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  mocks.fetch.mockReset()
})
describe("central authorization entry", () => {
  it("cannot approve a URL missing the server interaction", async () => {
    mocks.params = new URLSearchParams("state=untrusted-query-state")
    render(<InteractionPanel />)
    expect((await screen.findByRole("alert")).textContent).toContain("登录交互缺失")
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: "授权设备" })).toBeNull()
  })
  it("retries a failed descriptor read without starting a new authorization", async () => {
    mocks.fetch.mockResolvedValueOnce(
      json({ error: "server_error", message: "code=synthetic-private" }, 503),
    )
    render(<InteractionPanel />)
    await screen.findByRole("alert")
    expect(document.body.textContent).not.toContain("synthetic-private")
    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    await screen.findByRole("button", { name: "授权设备" })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(
      mocks.fetch.mock.calls.every(
        ([url]) => String(url) === "/v1/identity/interactions/interaction-1?realm=User",
      ),
    ).toBe(true)
    expect(identityNavigation.assign).not.toHaveBeenCalled()
  })
  it("consumes one explicit approval and uses only the server callback state", async () => {
    let complete: ((response: Response) => void) | undefined
    mocks.fetch.mockImplementation(async (_url, init) =>
      init?.method === "POST"
        ? new Promise<Response>((resolve) => {
            complete = resolve
          })
        : json(deviceInteraction()),
    )
    render(<InteractionPanel />)
    const approve = await screen.findByRole("button", { name: "授权设备" })
    fireEvent.click(approve)
    fireEvent.click(approve)
    await waitFor(() =>
      expect(mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1),
    )
    const post = mocks.fetch.mock.calls.find(([, init]) => init?.method === "POST")!
    expect(JSON.parse(String(post[1]?.body))).toEqual({
      realm: "User",
      csrf: "csrf-marker",
      expectedBindingEpoch: "9007199254740993",
      reauthorize: false,
    })
    expect((approve as HTMLButtonElement).disabled).toBe(true)
    complete?.(
      json({
        type: "redirect",
        redirect: "pigclaude://authorize/callback?code=synthetic&state=a%2Bb%2520",
      }),
    )
    await waitFor(() =>
      expect(identityNavigation.assign).toHaveBeenCalledWith(
        "pigclaude://authorize/callback?code=synthetic&state=a%2Bb%2520",
      ),
    )
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })
  it("does not extend the original deadline or offer approval for expired context", async () => {
    mocks.fetch.mockImplementation(async () =>
      json({ ...deviceInteraction(), expiresAt: Math.floor(Date.now() / 1000) - 1 }),
    )
    render(<InteractionPanel />)
    expect((await screen.findByRole("alert")).textContent).toContain("已过期")
    expect(screen.queryByRole("button", { name: "授权设备" })).toBeNull()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
})
