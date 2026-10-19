// 负责真实生产认证拒绝测试与受控 SDK proof 获取；任何秘密均不进入断言输出。
import { expect, type APIRequestContext, type Page } from "@playwright/test"
import { productionOrigin, proofTimeout } from "./turnstile-production-support"

/** 三路认证必须拒绝缺失、伪造和超长证明且不签发 Cookie。 */
export async function rejectMalformedProofs(request: APIRequestContext): Promise<void> {
  for (const path of ["/v1/auth/register", "/v1/auth/login", "/admin/v1/auth/login"]) {
    const admin = path.startsWith("/admin/")
    for (const token of [undefined, "forged-proof", "x".repeat(2049)]) {
      const response = await request
        .post(`${productionOrigin(admin ? "admin" : "home")}${path}`, {
          data: {
            email: "negative@example.test",
            nickname: "验证码拒绝验收",
            account: "negative",
            password: "negative-password",
            ...(token === undefined ? {} : { captchaToken: token }),
          },
        })
        .catch(() => {
          throw new Error("生产拒绝请求失败")
        })
      expect(response.status()).toBe(400)
      expect(Boolean(response.headers()["set-cookie"])).toBe(false)
      const body: unknown = await response.json()
      expect(
        typeof body === "object" &&
          body !== null &&
          "code" in body &&
          body.code === (token === undefined ? "CAPTCHA_REQUIRED" : "CAPTCHA_INVALID"),
      ).toBe(true)
    }
  }
}
/** 在真实来源页面装入真实 Cloudflare SDK，等待真人完成受控 action 的新 proof。 */
export async function sdkProof(
  page: Page,
  surface: "home" | "admin",
  siteKey: string,
  action: string,
): Promise<string> {
  await page.goto(`${productionOrigin(surface)}/login`)
  try {
    return await page.evaluate(
      async ({ siteKey, action, timeout }) => {
        const container = document.createElement("div")
        container.style.cssText =
          "position:fixed;top:0;left:0;z-index:2147483647;background:white;padding:24px"
        document.body.prepend(container)
        const script = document.createElement("script")
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        await new Promise<void>((resolve, reject) => {
          script.onload = () => resolve()
          script.onerror = () => reject(new Error("SDK加载失败"))
          document.head.append(script)
        })
        const sdk = (
          window as unknown as {
            turnstile: {
              ready(callback: () => void): void
              render(
                element: HTMLElement,
                options: {
                  sitekey: string
                  action: string
                  callback: (proof: string) => void
                  "error-callback": () => void
                },
              ): string
              remove(id: string): void
            }
          }
        ).turnstile
        return await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => {
            container.remove()
            reject(new Error("真人proof未完成"))
          }, timeout)
          sdk.ready(() => {
            const id = sdk.render(container, {
              sitekey: siteKey,
              action,
              callback: (proof) => {
                clearTimeout(timer)
                resolve(proof)
                sdk.remove(id)
                container.remove()
              },
              "error-callback": () => {
                clearTimeout(timer)
                reject(new Error("真实proof失败"))
              },
            })
          })
        })
      },
      { siteKey, action, timeout: proofTimeout() },
    )
  } catch {
    throw new Error("真实SDK未取得proof，NOT VERIFIED")
  }
}
/** 使用无效账号消费 proof：首次通过验证码到达401，重放必须400；过期proof首次提交也400。 */
export async function rejectReplayAndExpiry(page: Page, siteKey: string): Promise<void> {
  const url = `${productionOrigin("home")}/v1/auth/login`
  const post = async (captchaToken: string) =>
    page.request
      .post(url, {
        data: { email: "negative@example.test", password: "negative-password", captchaToken },
      })
      .catch(() => {
        throw new Error("proof拒绝请求失败")
      })
  const proof = await sdkProof(page, "home", siteKey, "home_login")
  expect((await post(proof)).status()).toBe(401)
  const replay = await post(proof)
  expect(replay.status()).toBe(400)
  expect(Boolean(replay.headers()["set-cookie"])).toBe(false)
  const wrongAction = await sdkProof(page, "home", siteKey, "admin_login")
  expect((await post(wrongAction)).status()).toBe(400)
  const expired = await sdkProof(page, "home", siteKey, "home_login")
  // 等待在测试内部执行；root 可持续查看 headed 页面，绝不复用已消费 proof。
  await new Promise((resolve) => setTimeout(resolve, 306_000))
  const response = await post(expired)
  expect(response.status()).toBe(400)
  expect(Boolean(response.headers()["set-cookie"])).toBe(false)
}
