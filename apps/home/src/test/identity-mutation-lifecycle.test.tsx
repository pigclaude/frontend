// 负责用真实组件和延迟 HTTP Promise 验证交互切换、卸载及 mutation 排他归属。
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { InteractionPanel } from "@/components/identity/interaction-panel"
import { identityNavigation } from "@/lib/identity-api"
import { interaction, json } from "./identity-fixture"

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(),
  fetch: vi.fn<typeof fetch>(),
}))
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.params }))

interface PendingRequest {
  url: string
  resolve: (value: Response) => void
  reject: (reason: Error) => void
}
const requests: PendingRequest[] = []

beforeEach(() => {
  requests.length = 0
  mocks.params = new URLSearchParams("interactionId=old&realm=User")
  vi.stubGlobal("fetch", mocks.fetch)
  vi.spyOn(identityNavigation, "assign").mockImplementation(() => undefined)
  mocks.fetch.mockImplementation(async (url, init) => {
    if (String(url).endsWith("captcha"))
      return json({ enabled: false, provider: "turnstile", siteKey: null, mode: "disabled" })
    if (init?.method === "POST")
      return new Promise<Response>((resolve, reject) => {
        requests.push({ url: String(url), resolve, reject })
      })
    const id = new URL(String(url), "https://home.invalid").pathname.split("/").at(-1)!
    return json(interaction({ interactionId: id, csrf: `csrf-${id}`, registrationAllowed: false }))
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  mocks.fetch.mockReset()
})

async function submitPassword() {
  await waitFor(() =>
    expect((screen.getByRole("button", { name: "登录" }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  )
  fireEvent.submit(document.querySelector("form")!)
  await waitFor(() => expect(requests.length).toBeGreaterThan(0))
}

async function settle(request: PendingRequest, kind: "redirect" | "descriptor" | "error") {
  await act(async () => {
    if (kind === "error") request.reject(new Error("synthetic-old-error"))
    else
      request.resolve(
        json(
          kind === "redirect"
            ? { type: "redirect", redirect: "/v1/web/oidc/callback?code=synthetic-old" }
            : {
                type: "require_consent",
                interaction: interaction({ interactionId: "old", phase: "consent" }),
              },
        ),
      )
  })
}

describe("central interaction mutation ownership", () => {
  it.each(["redirect", "descriptor", "error"] as const)(
    "ignores old password %s after switching to another interaction",
    async (kind) => {
      const view = render(<InteractionPanel />)
      await submitPassword()
      const oldRequest = requests[0]
      mocks.params = new URLSearchParams("interactionId=new&realm=User")
      view.rerender(<InteractionPanel />)
      const email = await screen.findByLabelText("邮箱")
      fireEvent.change(email, { target: { value: "new@example.com" } })
      await settle(oldRequest, kind)
      expect(identityNavigation.assign).not.toHaveBeenCalled()
      expect((screen.getByLabelText("邮箱") as HTMLInputElement).value).toBe("new@example.com")
      expect(screen.queryByRole("button", { name: "同意并继续" })).toBeNull()
      expect(screen.queryByRole("alert")).toBeNull()
    },
  )

  it.each(["redirect", "descriptor"] as const)(
    "ignores old password %s after unmount and remount",
    async (kind) => {
      const oldView = render(<InteractionPanel />)
      await submitPassword()
      const oldRequest = requests[0]
      oldView.unmount()
      mocks.params = new URLSearchParams("interactionId=new&realm=User")
      render(<InteractionPanel />)
      await screen.findByLabelText("邮箱")
      await settle(oldRequest, kind)
      expect(identityNavigation.assign).not.toHaveBeenCalled()
      expect(screen.queryByRole("button", { name: "同意并继续" })).toBeNull()
      expect(screen.getByLabelText("邮箱")).toBeTruthy()
    },
  )

  it("excludes provider and duplicate password while password HTTP is pending, then recovers", async () => {
    render(<InteractionPanel />)
    await submitPassword()
    const provider = screen.getByRole("button", { name: "Google" }) as HTMLButtonElement
    expect(provider.disabled).toBe(true)
    fireEvent.click(provider)
    fireEvent.submit(document.querySelector("form")!)
    expect(requests).toHaveLength(1)
    await act(async () => requests[0].resolve(json({ error: "invalid_credentials" }, 401)))
    await waitFor(() => expect(provider.disabled).toBe(false))
    fireEvent.click(provider)
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1].url).toMatch(/\/providers\/google\/start$/)
  })

  it.each(["password", "provider"] as const)(
    "old password finalizer cannot clear the new interaction's pending %s owner",
    async (newKind) => {
      const view = render(<InteractionPanel />)
      await submitPassword()
      const oldRequest = requests[0]
      mocks.params = new URLSearchParams("interactionId=new&realm=User")
      view.rerender(<InteractionPanel />)
      await screen.findByLabelText("邮箱")
      if (newKind === "password") await submitPassword()
      else fireEvent.click(screen.getByRole("button", { name: "Google" }))
      await waitFor(() => expect(requests).toHaveLength(2))
      const currentRequest = requests[1]
      expect(currentRequest.url).toContain("/new/")
      await settle(oldRequest, "error")
      expect((screen.getByRole("button", { name: "Google" }) as HTMLButtonElement).disabled).toBe(
        true,
      )
      fireEvent.click(screen.getByRole("button", { name: "GitHub" }))
      fireEvent.submit(document.querySelector("form")!)
      expect(requests).toHaveLength(2)
      expect(screen.queryByRole("alert")).toBeNull()
      await act(async () => currentRequest.resolve(json({ error: "invalid_request" }, 400)))
      await waitFor(() =>
        expect((screen.getByRole("button", { name: "Google" }) as HTMLButtonElement).disabled).toBe(
          false,
        ),
      )
    },
  )
})
