// 负责固定生产来源、校验公开配置并约束脱敏证据；秘密只留在验收进程内存。
import { expect, type APIRequestContext, type Page } from "@playwright/test"

/** 返回唯一获准的生产 HTTPS 来源。 */
export function productionOrigin(surface: "home" | "admin"): string {
  return surface === "home" ? "https://pigclaude.com" : "https://admin.pigclaude.com"
}
/** 严格校验四字段正式配置，拒绝 Cloudflare 官方测试 key。 */
export function validatePublicConfig(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false
  const config = value as Record<string, unknown>
  return (
    Object.keys(config).sort().join(",") === "enabled,mode,provider,siteKey" &&
    config.enabled === true &&
    config.provider === "turnstile" &&
    config.mode === "required" &&
    typeof config.siteKey === "string" &&
    config.siteKey.length > 0 &&
    !/^[123]x0{10,}/.test(config.siteKey)
  )
}
/** 只允许记录不含认证材料的实际事实。 */
export function safeEvidence(value: Record<string, unknown>): Record<string, unknown> {
  const allowed = ["status", "action", "hostname", "revision", "passed", "step"]
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error("证据包含未授权字段")
  return value
}
/** 读取显式输入，缺失时只报告变量名。 */
export function acceptanceInput(name: string): string {
  const value = process.env[`PIGCLAUDE_ACCEPTANCE_${name}`]
  if (!value) throw new Error(`缺少 PIGCLAUDE_ACCEPTANCE_${name}`)
  return value
}
/** 配置真人完成 challenge 的等待上限，超时失败而非跳过。 */
export function proofTimeout(): number {
  const seconds = Number(process.env["PIGCLAUDE_ACCEPTANCE_PROOF_TIMEOUT_SECONDS"] ?? "90")
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600)
    throw new Error("proof等待秒数无效")
  return seconds * 1000
}
/** 从真实 HTTPS 读取配置，错误不回显响应正文。 */
export async function readProductionConfig(
  request: APIRequestContext,
  surface: "home" | "admin",
): Promise<string> {
  const prefix = surface === "home" ? "/v1" : "/admin/v1"
  const response = await request
    .get(`${productionOrigin(surface)}${prefix}/auth/captcha`)
    .catch(() => {
      throw new Error("生产 HTTPS 配置不可用")
    })
  expect(response.status()).toBe(200)
  const config: unknown = await response.json()
  expect(validatePublicConfig(config)).toBe(true)
  return (config as { siteKey: string }).siteKey
}
const lastProof = new WeakMap<Page, string>()

/** 等待真实组件可提交并只保留响应状态；不输出请求、proof 或正文。 */
export async function submit(
  page: Page,
  name: string,
  path: string,
  status: number,
): Promise<void> {
  const button = page.getByRole("button", { name, exact: true })
  await expect(button).toBeEnabled({ timeout: proofTimeout() })
  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).origin === new URL(page.url()).origin &&
      new URL(response.url()).pathname === path &&
      response.request().method() === "POST",
  )
  await button.click()
  const response = await responsePromise
  const body: unknown = response.request().postDataJSON()
  const proof =
    typeof body === "object" && body !== null && "captchaToken" in body
      ? body.captchaToken
      : undefined
  expect(typeof proof === "string" && proof.length > 0 && proof !== lastProof.get(page)).toBe(true)
  if (typeof proof === "string") lastProof.set(page, proof)
  expect(response.status()).toBe(status)
  console.log(
    JSON.stringify(
      safeEvidence({
        step: path,
        status: response.status(),
        hostname: new URL(page.url()).hostname,
        passed: true,
      }),
    ),
  )
}
/** 用真实页面登录独立验收管理员，不保存 storageState。 */
export async function adminLogin(page: Page, readonly = false): Promise<void> {
  await page.goto(`${productionOrigin("admin")}/login`)
  await page
    .getByLabel("账号")
    .fill(acceptanceInput(readonly ? "READONLY_ACCOUNT" : "ADMIN_ACCOUNT"))
  await page
    .getByLabel("密码", { exact: true })
    .fill(acceptanceInput(readonly ? "READONLY_PASSWORD" : "ADMIN_PASSWORD"))
  await submit(page, "登录", "/admin/v1/auth/login", 200)
  await expect(page).toHaveURL(/\/users$/)
}
