// 负责验证验证码公开配置与错误保留 cookie 边界，同时不会触发账户失效回调。
import { describe, expect, it, vi } from "vitest"
import { createClient } from "./client"
import { createHomeApi } from "./home/endpoints"
import { createAdminApi } from "./admin/endpoints"

describe("captcha API boundaries", () => {
  it.each(["home", "admin"] as const)(
    "loads public %s config with the existing cookie client",
    async (app) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            enabled: false,
            provider: "turnstile",
            siteKey: null,
            mode: "disabled",
          }),
        ),
      )
      const client = createClient({ fetch: fetcher })
      const api = app === "home" ? createHomeApi(client) : createAdminApi(client)
      expect(await api.auth.captcha()).toEqual({
        enabled: false,
        provider: "turnstile",
        siteKey: null,
        mode: "disabled",
      })
      expect(fetcher).toHaveBeenCalledWith(
        app === "home" ? "/v1/auth/captcha" : "/admin/v1/auth/captcha",
        expect.objectContaining({ credentials: "include" }),
      )
    },
  )

  it.each([
    [400, "CAPTCHA_REQUIRED"],
    [400, "CAPTCHA_INVALID"],
    [503, "CAPTCHA_UNAVAILABLE"],
  ])("preserves %s captcha code without unauthorized recovery", async (status, code) => {
    const onUnauthorized = vi.fn()
    const client = createClient({
      onUnauthorized,
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify({ code }), { status: Number(status) })),
    })
    await expect(
      client.post("/v1/auth/login", { captchaToken: "current-token" }),
    ).rejects.toMatchObject({ code })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})
