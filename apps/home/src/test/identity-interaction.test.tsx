// 负责验证中央密码、注册、明确 consent 与设备审批的真实 HTTP 接续。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { InteractionPanel } from "@/components/identity/interaction-panel"
import { identityNavigation } from "@/lib/identity-api"
import { interaction, json } from "./identity-fixture"
const mocks = vi.hoisted(() => ({
  params: new URLSearchParams("interactionId=interaction-1&realm=User"),
  fetch: vi.fn<typeof fetch>(),
}))
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.params }))
beforeEach(() => {
  vi.stubGlobal("fetch", mocks.fetch)
  mocks.params = new URLSearchParams("interactionId=interaction-1&realm=User")
  mocks.fetch.mockImplementation(async (url, init) =>
    String(url).endsWith("/auth/captcha")
      ? json({ enabled: false, provider: "turnstile", siteKey: null, mode: "disabled" })
      : init?.method === "POST"
        ? json({
            type: "redirect",
            redirect: "/v1/web/oidc/callback?code=synthetic&state=a%2Bb%2520",
          })
        : json(interaction()),
  )
  vi.spyOn(identityNavigation, "assign").mockImplementation(() => undefined)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  mocks.fetch.mockReset()
})
function posts() {
  return mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")
}
describe("identity interaction", () => {
  it("retains password visibility and submits register with server CSRF without RP calls", async () => {
    render(<InteractionPanel />)
    await screen.findByLabelText("密码")
    fireEvent.click(screen.getByRole("button", { name: "显示密码" }))
    expect((screen.getByLabelText("密码") as HTMLInputElement).type).toBe("text")
    fireEvent.keyDown(screen.getByRole("tab", { name: "注册" }), { key: "Enter" })
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "ada@example.com" } })
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password" } })
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "创建账号" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    fireEvent.submit(document.querySelector("form")!)
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0][0]).toBe("/v1/identity/interactions/interaction-1/password")
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({
      realm: "User",
      csrf: "csrf-marker",
      mode: "register",
      email: "ada@example.com",
      password: "password",
    })
    await waitFor(() =>
      expect(identityNavigation.assign).toHaveBeenCalledWith(
        "/v1/web/oidc/callback?code=synthetic&state=a%2Bb%2520",
      ),
    )
    expect(mocks.fetch.mock.calls.some(([url]) => String(url).includes("/user/me"))).toBe(false)
  })
  it("renders realm from the server and removes admin registration/providers", async () => {
    mocks.fetch.mockImplementation(async (url) =>
      String(url).endsWith("captcha")
        ? json({ enabled: false, provider: "turnstile", siteKey: null, mode: "disabled" })
        : json(interaction({ realm: "Admin", registrationAllowed: false, providers: [] })),
    )
    render(<InteractionPanel />)
    await screen.findByRole("heading", { name: "管理员登录" })
    expect(screen.queryByRole("tab", { name: "注册" })).toBeNull()
    expect(screen.queryByText("使用 Google 登录")).toBeNull()
  })
  it.each([
    { status: "new", epoch: null },
    { status: "active", epoch: "9007199254740993" },
    { status: "revoked", epoch: "9007199254740994" },
  ] as const)(
    "requires explicit native confirmation for $status relation",
    async ({ status, epoch }) => {
      mocks.fetch.mockImplementation(async (_url, init) =>
        init?.method === "POST"
          ? json({
              type: "redirect",
              redirect: "pigclaude://authorize/callback?code=synthetic&state=a%2Bb%2520",
            })
          : json(
              interaction({
                phase: "device_approval",
                device: {
                  deviceId: "pcd_fixture",
                  platform: "macos",
                  name: "我的 Mac",
                  status,
                  bindingEpoch: epoch,
                },
              }),
            ),
      )
      render(<InteractionPanel />)
      await screen.findByText("我的 Mac")
      expect(posts()).toHaveLength(0)
      const approve = screen.getByRole("button", {
        name: status === "revoked" ? "重新授权设备" : "授权设备",
      })
      if (status === "revoked") {
        expect((approve as HTMLButtonElement).disabled).toBe(true)
        fireEvent.click(screen.getByRole("checkbox"))
      }
      fireEvent.click(approve)
      await waitFor(() => expect(posts()).toHaveLength(1))
      expect(posts()[0][0]).toBe("/v1/identity/interactions/interaction-1/approve-device")
      expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({
        realm: "User",
        csrf: "csrf-marker",
        expectedBindingEpoch: epoch,
        reauthorize: status === "revoked",
      })
      expect(identityNavigation.assign).toHaveBeenCalledWith(
        "pigclaude://authorize/callback?code=synthetic&state=a%2Bb%2520",
      )
      expect(mocks.fetch.mock.calls.some(([url]) => String(url).includes("/user/me"))).toBe(false)
    },
  )
  it("keeps web consent distinct and explicitly posts denial", async () => {
    mocks.fetch.mockImplementation(async (_url, init) =>
      init?.method === "POST"
        ? json({
            type: "redirect",
            redirect: "/v1/web/oidc/callback?error=access_denied&state=a%2Bb%2520",
          })
        : json(interaction({ phase: "consent" })),
    )
    render(<InteractionPanel />)
    await screen.findByRole("button", { name: "同意并继续" })
    expect(posts()).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: "拒绝" }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(String(posts()[0][0])).toMatch(/\/deny$/)
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({ realm: "User", csrf: "csrf-marker" })
    await waitFor(() =>
      expect(identityNavigation.assign).toHaveBeenCalledWith(
        "/v1/web/oidc/callback?error=access_denied&state=a%2Bb%2520",
      ),
    )
  })
})

it("does not silently treat password authentication as web consent", async () => {
  mocks.fetch.mockImplementation(async (url, init) =>
    String(url).endsWith("captcha")
      ? json({ enabled: false, provider: "turnstile", siteKey: null, mode: "disabled" })
      : init?.method === "POST"
        ? String(url).endsWith("/password")
          ? json({ type: "require_consent", interaction: interaction({ phase: "consent" }) })
          : json({ type: "redirect", redirect: "/v1/web/oidc/callback?code=synthetic" })
        : json(interaction()),
  )
  render(<InteractionPanel />)
  await waitFor(() =>
    expect((screen.getByRole("button", { name: "登录" }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  )
  fireEvent.submit(document.querySelector("form")!)
  await screen.findByRole("button", { name: "同意并继续" })
  expect(posts()).toHaveLength(1)
  expect(identityNavigation.assign).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "同意并继续" }))
  await waitFor(() => expect(posts()).toHaveLength(2))
  expect(String(posts()[1][0])).toMatch(/\/consent$/)
  expect(JSON.parse(String(posts()[1][1]?.body))).toEqual({ realm: "User", csrf: "csrf-marker" })
  await waitFor(() =>
    expect(identityNavigation.assign).toHaveBeenCalledWith("/v1/web/oidc/callback?code=synthetic"),
  )
})
