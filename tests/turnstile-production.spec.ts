// 负责真实 HTTPS 后台配置及三路登录门禁；本文件没有 fixture、mock、测试 key 或 skip。
import { test, expect } from "@playwright/test"
import {
  acceptanceInput,
  adminLogin,
  productionOrigin,
  readProductionConfig,
  submit,
} from "./turnstile-production-support"
import {
  rejectMalformedProofs,
  rejectReplayAndExpiry,
  sdkProof,
} from "./turnstile-production-negative"

// 只打印固定失败语句，阻止 Playwright call log 携带 fill/request 秘密值。
async function privateStep(action: () => Promise<void>): Promise<void> {
  try {
    await action()
  } catch {
    throw new Error(
      "生产验收步骤失败；该步骤 NOT VERIFIED，请 root 在当前 headed 页面诊断（禁止记录秘密）",
    )
  }
}

test("真实四字段正式配置与三路无效证明拒绝", async ({ request }) => {
  await privateStep(async () => {
    await readProductionConfig(request, "home")
    await readProductionConfig(request, "admin")
    await rejectMalformedProofs(request)
  })
})

test("后台真实保存启用、审计、Secret不回显及边界", async ({ page, browser }) => {
  await privateStep(async () => {
    await adminLogin(page)
    await page.goto(`${productionOrigin("admin")}/settings`)
    await page.getByLabel("Site Key", { exact: true }).fill(acceptanceInput("SITE_KEY"))
    await page.getByLabel("允许主机名", { exact: true }).fill("pigclaude.com\nadmin.pigclaude.com")
    await page.getByLabel("Secret Key", { exact: true }).fill(acceptanceInput("SECRET_KEY"))
    const enabled = page.getByRole("switch", { name: "草稿启用验证" })
    if ((await enabled.getAttribute("aria-checked")) !== "true") await enabled.click()
    await submit(page, "保存草稿", "/admin/v1/settings/turnstile/draft", 200)
    await submit(page, "验证并启用", "/admin/v1/settings/turnstile/activate", 200)
    const endpoint = `${productionOrigin("admin")}/admin/v1/settings/turnstile`
    const readView = async () => {
      const response = await page.request.get(endpoint)
      expect(response.status()).toBe(200)
      const text = await response.text()
      expect(text.includes(acceptanceInput("SECRET_KEY"))).toBe(false)
      return JSON.parse(text) as {
        revision: string
        active: { revision: string; enabled: boolean }
        draft: unknown
      }
    }
    const before = await readView()
    expect(before.active.enabled).toBe(true)
    await expect(page.getByRole("heading", { name: "变更历史" })).toBeVisible()
    const audits = await page.request.get(`${endpoint}/audits`)
    expect(audits.status()).toBe(200)
    expect((await audits.text()).includes(acceptanceInput("SECRET_KEY"))).toBe(false)
    await page.reload()
    expect((await page.getByLabel("Secret Key", { exact: true }).inputValue()).length === 0).toBe(
      true,
    )
    const cached = await page.evaluate(() =>
      JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
    )
    expect(cached.includes(acceptanceInput("SECRET_KEY"))).toBe(false)
    const draft = {
      expectedRevision: before.revision,
      enabled: true,
      siteKey: acceptanceInput("SITE_KEY"),
      hostnames: ["admin.pigclaude.com"],
    }
    const invalid = await page.request.put(`${endpoint}/draft`, {
      headers: { Origin: productionOrigin("admin") },
      data: { ...draft, hostnames: ["invalid/path"] },
    })
    expect(invalid.status()).toBe(400)
    expect((await readView()).revision === before.revision).toBe(true)
    const conflict = await page.request.put(`${endpoint}/draft`, {
      headers: { Origin: productionOrigin("admin") },
      data: { ...draft, expectedRevision: "0" },
    })
    expect(conflict.status()).toBe(409)
    expect((await readView()).revision === before.revision).toBe(true)
    const saved = await page.request.put(`${endpoint}/draft`, {
      headers: { Origin: productionOrigin("admin") },
      data: draft,
    })
    expect(saved.status()).toBe(200)
    const candidate = await readView()
    const proof = await sdkProof(page, "home", acceptanceInput("SITE_KEY"), "admin_login")
    const rejected = await page.request.post(`${endpoint}/activate`, {
      headers: { Origin: productionOrigin("admin") },
      data: { expectedRevision: candidate.revision, captchaToken: proof },
    })
    expect(rejected.status()).toBe(400)
    const after = await readView()
    expect(
      after.revision === candidate.revision && after.active.revision === before.active.revision,
    ).toBe(true)
    // 将允许两域名的合法草稿恢复并真实验证，始终保持 active required。
    await page.goto(`${productionOrigin("admin")}/settings`)
    await page.getByLabel("允许主机名", { exact: true }).fill("pigclaude.com\nadmin.pigclaude.com")
    await submit(page, "保存草稿", "/admin/v1/settings/turnstile/draft", 200)
    await submit(page, "验证并启用", "/admin/v1/settings/turnstile/activate", 200)
    const readonlyContext = await browser.newContext()
    try {
      const readonlyPage = await readonlyContext.newPage()
      await adminLogin(readonlyPage, true)
      const forbidden = await readonlyPage.request.put(`${endpoint}/draft`, {
        headers: { Origin: productionOrigin("admin") },
        data: draft,
      })
      expect(forbidden.status()).toBe(403)
    } finally {
      await readonlyContext.close()
    }
  })
})

test("独立用户真实注册退出、错误密码后新proof重登及新admin登录", async ({ page, browser }) => {
  await privateStep(async () => {
    const home = productionOrigin("home")
    await page.goto(`${home}/register`)
    await page.getByLabel("昵称").fill("生产验证码验收")
    await page.getByLabel("邮箱").fill(acceptanceInput("USER_EMAIL"))
    await page.getByLabel("密码", { exact: true }).fill(acceptanceInput("USER_PASSWORD"))
    await submit(page, "创建账号", "/v1/auth/register", 201)
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page.getByRole("heading", { name: "账户概览" })).toBeVisible()
    await page.getByRole("button", { name: "用户菜单", exact: true }).click()
    await page.getByRole("menuitem", { name: "退出登录", exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    await page.getByLabel("邮箱").fill(acceptanceInput("USER_EMAIL"))
    await page.getByLabel("密码", { exact: true }).fill(`${acceptanceInput("USER_PASSWORD")}-wrong`)
    await submit(page, "登录", "/v1/auth/login", 401)
    await page.getByLabel("密码", { exact: true }).fill(acceptanceInput("USER_PASSWORD"))
    await submit(page, "登录", "/v1/auth/login", 200)
    await expect(page).toHaveURL(/\/dashboard$/)
    const context = await browser.newContext()
    try {
      const admin = await context.newPage()
      await adminLogin(admin)
      // 后台实际查询本次用户，断言仅在内存中比较，不输出邮箱。
      await expect(admin.getByText(acceptanceInput("USER_EMAIL"), { exact: true })).toBeVisible()
    } finally {
      await context.close()
    }
    await page.getByRole("button", { name: "用户菜单", exact: true }).click()
    await page.getByRole("menuitem", { name: "退出登录", exact: true }).click()
  })
})

test("真实SDK一次性重放、错误action与306秒未消费proof过期", async ({ page }) => {
  await privateStep(async () => {
    const siteKey = await readProductionConfig(page.request, "home")
    await rejectReplayAndExpiry(page, siteKey)
  })
})
