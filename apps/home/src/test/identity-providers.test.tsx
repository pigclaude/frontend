// 负责验证供应商按钮不依赖密码验证码，配置与失败均保持隔离。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { InteractionPanel } from "@/components/identity/interaction-panel"
import { identityNavigation } from "@/lib/identity-api"
import { interaction, json } from "./identity-fixture"
const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }))
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("interactionId=interaction-1&realm=User"),
}))
beforeEach(() => {
  vi.stubGlobal("fetch", mocks.fetch)
  vi.spyOn(identityNavigation, "assign").mockImplementation(() => undefined)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  mocks.fetch.mockReset()
})
describe("independent provider login", () => {
  it.each(["google", "github"])("starts %s while password captcha is pending", async (provider) => {
    mocks.fetch.mockImplementation(async (url, init) =>
      String(url).endsWith("captcha")
        ? new Promise<Response>(() => undefined)
        : init?.method === "POST"
          ? json({
              type: "redirect",
              redirect: `https://${provider}.example/authorize?state=synthetic`,
            })
          : json(interaction()),
    )
    render(<InteractionPanel />)
    const button = await screen.findByRole("button", {
      name: provider === "google" ? "使用 Google 登录" : "使用 GitHub 登录",
    })
    expect((screen.getByRole("button", { name: "登录" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(button)
    await waitFor(() => expect(identityNavigation.assign).toHaveBeenCalled())
    const post = mocks.fetch.mock.calls.find(([, init]) => init?.method === "POST")!
    expect(post[0]).toBe(`/v1/identity/interactions/interaction-1/providers/${provider}/start`)
    expect(JSON.parse(String(post[1]?.body))).toEqual({ realm: "User", csrf: "csrf-marker" })
  })
  it("hides disabled providers and never reflects upstream error details", async () => {
    mocks.fetch.mockImplementation(async (url, init) =>
      String(url).endsWith("captcha")
        ? json({ enabled: false, provider: "turnstile", siteKey: null, mode: "disabled" })
        : init?.method === "POST"
          ? json({ error: "server_error", message: "code=synthetic-secret" }, 503)
          : json(interaction({ providers: ["github"] })),
    )
    render(<InteractionPanel />)
    fireEvent.click(await screen.findByRole("button", { name: "使用 GitHub 登录" }))
    expect(screen.queryByRole("button", { name: "使用 Google 登录" })).toBeNull()
    await screen.findByRole("alert")
    expect(document.body.textContent).not.toContain("synthetic-secret")
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "登录" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
  })
})
