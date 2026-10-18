// 负责用官方测试组件、真实Rust与Cloudflare验证本地验证码门禁；不保存凭据或冒充生产反机器人验收。
import { test, expect, type APIRequestContext, type Page, type Response } from "@playwright/test"
import { randomUUID } from "node:crypto"

const dummyToken = "XXXX.DUMMY.TOKEN.XXXX"

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

async function submitAndObserve(page: Page, name: string, path: string): Promise<Response> {
  const submit = page.getByRole("button", { name, exact: true })
  await expect(submit).toBeEnabled()
  const [response] = await Promise.all([
    page.waitForResponse(
      (value) =>
        new URL(value.url()).origin === new URL(page.url()).origin &&
        new URL(value.url()).pathname === path &&
        value.request().method() === "POST",
    ),
    submit.click(),
  ])
  const body: unknown = await Promise.resolve()
    .then(() => response.request().postDataJSON())
    .catch(() => {
      throw new Error("验证码请求不是有效JSON；不输出请求正文")
    })
  const carriesProof =
    typeof body === "object" &&
    body !== null &&
    "captchaToken" in body &&
    body.captchaToken === dummyToken
  expect(carriesProof).toBe(true)
  return response
}

test("公开配置仅返回可用于本地官方组件的非秘密字段", async ({ request }) => {
  await readPublicConfig(request, `${environment("PIGCLAUDE_HOME_URL")}/v1/auth/captcha`)
  await readPublicConfig(request, `${environment("PIGCLAUDE_ADMIN_URL")}/admin/v1/auth/captcha`)
})

test("三条认证端点在缺失、伪造或超长证明时拒绝且不签发Cookie", async ({ request }) => {
  const home = environment("PIGCLAUDE_HOME_URL")
  const admin = environment("PIGCLAUDE_ADMIN_URL")
  await readPublicConfig(request, `${home}/v1/auth/captcha`)
  const credentials = {
    email: `captcha-negative-${randomUUID()}@example.test`,
    password: randomUUID(),
  }
  const endpoints = [
    { url: `${home}/v1/auth/register`, body: { ...credentials, nickname: "验证码拒绝验收" } },
    { url: `${home}/v1/auth/login`, body: credentials },
    {
      url: `${admin}/admin/v1/auth/login`,
      body: { account: "captcha-negative", password: randomUUID() },
    },
  ]
  const attempts = [
    { token: undefined, code: "CAPTCHA_REQUIRED" },
    { token: "forged-human-proof", code: "CAPTCHA_INVALID" },
    { token: "x".repeat(2049), code: "CAPTCHA_INVALID" },
  ]
  for (const endpoint of endpoints) {
    for (const attempt of attempts) {
      const response = await request
        .post(endpoint.url, {
          data: {
            ...endpoint.body,
            ...(attempt.token === undefined ? {} : { captchaToken: attempt.token }),
          },
        })
        .catch(() => {
          throw new Error("验证码拒绝请求失败；不输出含密码的请求信息")
        })
      expect(response.status()).toBe(400)
      expect(Boolean(response.headers()["set-cookie"])).toBe(false)
      const result: unknown = await response.json()
      const rejectedSafely =
        typeof result === "object" &&
        result !== null &&
        Object.keys(result).join(",") === "code" &&
        "code" in result &&
        result.code === attempt.code
      expect(rejectedSafely).toBe(true)
    }
  }
})

test("真实官方测试组件完成注册、退出、凭据失败重试和管理员登录", async ({ page, browser }) => {
  test.setTimeout(120_000)
  const home = environment("PIGCLAUDE_HOME_URL")
  const adminUrl = environment("PIGCLAUDE_ADMIN_URL")
  await readPublicConfig(page.request, `${home}/v1/auth/captcha`)
  const email = `turnstile-${randomUUID()}@example.test`
  const password = randomUUID()
  await page.goto(`${home}/register`)
  await page.getByLabel("昵称").fill("Cloudflare本地验收")
  await page.getByLabel("邮箱").fill(email)
  await page
    .getByLabel("密码", { exact: true })
    .fill(password)
    .catch(() => {
      throw new Error("注册密码字段填写失败")
    })
  await expect(
    page.locator('script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]'),
  ).toHaveCount(1)
  expect((await submitAndObserve(page, "创建账号", "/v1/auth/register")).status()).toBe(201)
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole("heading", { name: "账户概览" })).toBeVisible()
  await page.getByRole("button", { name: "用户菜单", exact: true }).click()
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel("邮箱").fill(email)
  await page
    .getByLabel("密码", { exact: true })
    .fill(randomUUID())
    .catch(() => {
      throw new Error("登录密码字段填写失败")
    })
  expect((await submitAndObserve(page, "登录", "/v1/auth/login")).status()).toBe(401)
  await expect(page).toHaveURL(/\/login$/)
  await page
    .getByLabel("密码", { exact: true })
    .fill(password)
    .catch(() => {
      throw new Error("重试密码字段填写失败")
    })
  expect((await submitAndObserve(page, "登录", "/v1/auth/login")).status()).toBe(200)
  await expect(page).toHaveURL(/\/dashboard$/)

  const adminContext = await browser.newContext()
  try {
    const admin = await adminContext.newPage()
    await readPublicConfig(admin.request, `${adminUrl}/admin/v1/auth/captcha`)
    await admin.goto(`${adminUrl}/login`)
    await admin.getByLabel("账号").fill(environment("PIGCLAUDE_ACCEPTANCE_ADMIN_ACCOUNT"))
    await admin
      .getByLabel("密码", { exact: true })
      .fill(environment("PIGCLAUDE_ACCEPTANCE_ADMIN_PASSWORD"))
      .catch(() => {
        throw new Error("管理员密码字段填写失败")
      })
    await expect(
      admin.locator('script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]'),
    ).toHaveCount(1)
    expect((await submitAndObserve(admin, "登录", "/admin/v1/auth/login")).status()).toBe(200)
    await expect(admin).toHaveURL(/\/users$/)
    await expect(admin.getByRole("heading", { name: "用户", exact: true })).toBeVisible()
  } finally {
    await adminContext.close()
  }
})
