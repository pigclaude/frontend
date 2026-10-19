// 负责验证服务端能力约束下的注册直达、StrictMode 和手动模式切换。
import { StrictMode } from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  beginWebOidcLogin,
  consumeRegistrationHint,
  webOidcNavigation,
} from "@pigclaude/api/web-oidc"
import { PasswordInteraction } from "@/components/identity/password-interaction"
import { interaction, json } from "./identity-fixture"
beforeEach(() => {
  vi.spyOn(webOidcNavigation, "assign").mockImplementation(() => undefined)
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({ enabled: false, provider: "turnstile", siteKey: null, mode: "disabled" }),
    ),
  )
})
afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe("central register mode", () => {
  it("opens User register once under StrictMode and preserves later manual selection", async () => {
    beginWebOidcLogin({ site: "home", mode: "register" })
    const view = render(
      <StrictMode>
        <PasswordInteraction interaction={interaction()} onContinue={() => undefined} />
      </StrictMode>,
    )
    await screen.findByRole("button", { name: "创建账号" })
    expect(consumeRegistrationHint()).toBe(false)
    fireEvent.keyDown(screen.getByRole("tab", { name: "登录" }), { key: "Enter" })
    await screen.findByRole("button", { name: "登录" })
    view.rerender(
      <StrictMode>
        <PasswordInteraction interaction={interaction()} onContinue={() => undefined} />
      </StrictMode>,
    )
    expect(screen.queryByRole("button", { name: "创建账号" })).toBeNull()
  })
  it.each(["Admin", "User"] as const)(
    "ignores hint when %s descriptor disallows register",
    async (realm) => {
      beginWebOidcLogin({ site: "home", mode: "register" })
      render(
        <PasswordInteraction
          interaction={interaction({ realm, registrationAllowed: false })}
          onContinue={() => undefined}
        />,
      )
      await waitFor(() =>
        expect((screen.getByRole("button", { name: "登录" }) as HTMLButtonElement).disabled).toBe(
          false,
        ),
      )
      expect(screen.queryByRole("tab", { name: "注册" })).toBeNull()
      expect(consumeRegistrationHint()).toBe(true)
    },
  )
})
