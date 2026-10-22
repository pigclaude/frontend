// 负责验证中央身份交互停留过久后只显示一条过期提示，并给出可用的重新发起入口。
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { InteractionPanel } from "@/components/identity/interaction-panel"
import { interaction, json } from "./identity-fixture"
const mocks = vi.hoisted(() => ({
  params: new URLSearchParams("interactionId=interaction-1&realm=User"),
  fetch: vi.fn<typeof fetch>(),
}))
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.params }))
const soon = () => Math.floor(Date.now() / 1000) + 2
const captcha = () =>
  json({ enabled: false, provider: "turnstile", siteKey: null, mode: "disabled" })
beforeEach(() => {
  vi.stubGlobal("fetch", mocks.fetch)
  mocks.params = new URLSearchParams("interactionId=interaction-1&realm=User")
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  mocks.fetch.mockReset()
})

it("switches an open login page to a single restart notice when the deadline passes", async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-22T00:00:00.000Z"))
  mocks.fetch.mockImplementation(async (url, init) =>
    String(url).endsWith("/auth/captcha")
      ? captcha()
      : init?.method === "POST"
        ? json({ error: "invalid_request" }, 400)
        : json(
            interaction({
              realm: "Admin",
              registrationAllowed: false,
              providers: [],
              expiresAt: soon(),
              restartUrl: "https://admin.pigclaude.com/login",
            }),
          ),
  )
  render(<InteractionPanel />)
  await vi.waitFor(() =>
    expect((screen.getByRole("button", { name: "登录" }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  )
  fireEvent.submit(document.querySelector("form")!)
  await vi.waitFor(() => expect(screen.getByRole("alert").textContent).toBeTruthy())
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000)
  })
  const restart = screen.getByRole("link", { name: "重新登录" })
  expect(restart.getAttribute("href")).toBe("https://admin.pigclaude.com/login")
  expect(screen.getAllByRole("alert")).toHaveLength(1)
  expect(screen.queryByRole("button", { name: "登录" })).toBeNull()
})

it("tells desktop authorizations to restart from the client", async () => {
  mocks.fetch.mockImplementation(async () =>
    json(
      interaction({
        clientId: "pigclaude-desktop",
        phase: "device_approval",
        expiresAt: Math.floor(Date.now() / 1000) - 1,
        restartUrl: null,
        device: {
          deviceId: "pcd_x",
          platform: "macos",
          name: "Mac",
          status: "new",
          bindingEpoch: null,
        },
      }),
    ),
  )
  render(<InteractionPanel />)
  expect((await screen.findByRole("alert")).textContent).toContain("回到 PigClaude 桌面端")
  expect(screen.queryByRole("link", { name: "重新登录" })).toBeNull()
})

it("does not send an admin to the user-site login when the interaction cannot be read", async () => {
  mocks.params = new URLSearchParams("interactionId=interaction-1&realm=Admin")
  mocks.fetch.mockImplementation(async () => json({ error: "invalid_request" }, 400))
  render(<InteractionPanel />)
  await screen.findByRole("alert")
  expect(screen.queryByRole("link", { name: "返回登录" })).toBeNull()
  expect(document.body.textContent).toContain("回到管理后台重新登录")
})
