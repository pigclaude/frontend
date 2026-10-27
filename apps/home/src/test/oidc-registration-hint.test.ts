// 负责验证一次性注册 UI 意图不扩展认证协议，且存储失败不阻断登录。
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  beginWebOidcLogin,
  consumeRegistrationHint,
  webOidcNavigation,
} from "@pigclaude/api/web-oidc"
afterEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
})
describe("registration UI hint", () => {
  it("consumes register once but sends no mode to RP start", () => {
    const navigation = vi.spyOn(webOidcNavigation, "assign").mockImplementation(() => undefined)
    beginWebOidcLogin({ site: "home", mode: "register" })
    expect(consumeRegistrationHint()).toBe(true)
    expect(consumeRegistrationHint()).toBe(false)
    expect(navigation.mock.calls[0][0]).not.toContain("mode=")
  })
  it.each(["home", "admin"] as const)("clears hint for explicit %s login", (site) => {
    vi.spyOn(webOidcNavigation, "assign").mockImplementation(() => undefined)
    beginWebOidcLogin({ site: "home", mode: "register" })
    beginWebOidcLogin({ site, mode: "login" })
    expect(consumeRegistrationHint()).toBe(false)
  })
  it("expires after ten minutes without storing sensitive context", () => {
    vi.spyOn(webOidcNavigation, "assign").mockImplementation(() => undefined)
    vi.spyOn(Date, "now").mockReturnValue(1000)
    beginWebOidcLogin({ site: "home", mode: "register", returnTo: "/private?state=synthetic" })
    expect(sessionStorage.length).toBe(1)
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).not.toMatch(/private|state|realm/)
    vi.mocked(Date.now).mockReturnValue(601001)
    expect(consumeRegistrationHint()).toBe(false)
  })
  it.each([
    "broken-json",
    '{"mode":"register","createdAt":"1"}',
    '{"mode":"register","createdAt":9999999999999}',
  ])("discards malformed or future hint %s", (raw) => {
    sessionStorage.setItem("pigclaude:registration-ui", raw)
    expect(consumeRegistrationHint()).toBe(false)
    expect(sessionStorage.length).toBe(0)
  })
  it("navigates when storage throws", () => {
    const navigation = vi.spyOn(webOidcNavigation, "assign").mockImplementation(() => undefined)
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("disabled")
    })
    expect(() => beginWebOidcLogin({ site: "home", mode: "register" })).not.toThrow()
    expect(navigation).toHaveBeenCalled()
    expect(consumeRegistrationHint()).toBe(false)
  })
})

it("explicit website switching forces fresh authentication and retains the local target", () => {
  const navigation = vi.spyOn(webOidcNavigation, "assign").mockImplementation(() => undefined)
  const returnTo = "/membership/recovery?target=00000000-0000-4000-8000-000000000001"
  beginWebOidcLogin({ site: "home", mode: "switch", returnTo })
  const link = new URL(navigation.mock.calls[0][0], "https://home.example.test")
  expect(link.pathname).toBe("/v1/web/oidc/start")
  expect(link.searchParams.get("maxAge")).toBe("0")
  expect(link.searchParams.get("returnTo")).toBe(returnTo)
  expect(consumeRegistrationHint()).toBe(false)
})
