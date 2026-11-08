// 验证可选的 CheckCC 检测页必须由用户确认，并完整保留本次授权参数。
// @vitest-environment jsdom
import { expect, it } from "vitest"
import { authorizationStartUrl } from "../../main/claude/account-service-preflight"

it("先提供 CheckCC 检测，确认后才可提交本次 OAuth 参数", () => {
  const oauth = new URL("https://claude.test/oauth/authorize")
  oauth.searchParams.set("state", "a&b")
  oauth.searchParams.set("redirect_uri", "http://localhost:1234/callback")
  oauth.searchParams.set("scope", "one two")
  const start = authorizationStartUrl(oauth.href, "checkcc")
  expect(start).toMatch(/^data:text\/html/)
  const html = decodeURIComponent(start.slice(start.indexOf(",") + 1))
  const document = new DOMParser().parseFromString(html, "text/html")
  const check = document.querySelector<HTMLAnchorElement>('a[href="https://checkcc.org/"]')
  expect(check?.target).toBe("_blank")
  expect(check?.rel).toContain("noreferrer")
  const form = document.querySelector<HTMLFormElement>("form")
  const confirmation = document.querySelector<HTMLInputElement>('input[type="checkbox"]')
  expect(confirmation?.required).toBe(true)
  expect(form?.checkValidity()).toBe(false)
  if (confirmation) confirmation.checked = true
  expect(form?.checkValidity()).toBe(true)
  expect(form?.action).toBe(`${oauth.origin}${oauth.pathname}`)
  const parameters = new URLSearchParams()
  for (const field of document.querySelectorAll<HTMLInputElement>('input[type="hidden"]')) {
    parameters.append(field.name, field.value)
  }
  expect(parameters.toString()).toBe(oauth.searchParams.toString())
})

it("未选择检测时维持原来的授权地址", () => {
  const oauth = "https://claude.test/authorize?state=synthetic"
  expect(authorizationStartUrl(oauth)).toBe(oauth)
})
