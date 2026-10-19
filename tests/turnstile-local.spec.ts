// 负责只读验证显式专用loopback服务的当前验证码公开配置；真实运行属于后续外部验收。
import { test, expect, type APIRequestContext } from "@playwright/test"

function environment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Turnstile真实本地验收缺少${name}`)
  if (name.endsWith("_URL") && new URL(value).hostname !== "127.0.0.1") {
    throw new Error("本地验证码验收只能访问专用loopback服务")
  }
  return value
}

async function readPublicConfig(request: APIRequestContext, url: string): Promise<void> {
  const response = await request.get(url).catch(() => {
    throw new Error("读取验证码公开配置失败")
  })
  expect(response.status()).toBe(200)
  const config: unknown = await response.json()
  const validConfig =
    typeof config === "object" &&
    config !== null &&
    Object.keys(config).sort().join(",") === "enabled,mode,provider,siteKey" &&
    "enabled" in config &&
    config.enabled === true &&
    "provider" in config &&
    config.provider === "turnstile" &&
    "siteKey" in config &&
    config.siteKey === "1x00000000000000000000AA" &&
    "mode" in config &&
    config.mode === "testing"
  expect(validConfig).toBe(true)
}

test("公开配置仅返回可用于本地官方组件的非秘密字段", async ({ request }) => {
  await readPublicConfig(request, `${environment("PIGCLAUDE_HOME_URL")}/v1/auth/captcha`)
  await readPublicConfig(request, `${environment("PIGCLAUDE_ADMIN_URL")}/admin/v1/auth/captcha`)
})
