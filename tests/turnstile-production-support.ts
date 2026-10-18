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
/** 脱敏证据仅接受固定动作、来源、路径和有界原始事实。 */
export interface ProductionEvidence {
  status?: number
  action?: "home_register" | "home_login" | "admin_login"
  hostname?: "pigclaude.com" | "admin.pigclaude.com"
  revision?: string
  passed?: boolean
  step?: SubmissionPath
}
/** 同时校验字段名和值，拒绝把任意秘密装入合法字段。 */
export function safeEvidence(value: Record<string, unknown>): ProductionEvidence {
  const validators: Record<string, (item: unknown) => boolean> = {
    status: (item) =>
      typeof item === "number" && Number.isInteger(item) && item >= 100 && item <= 599,
    action: (item) =>
      typeof item === "string" && ["home_register", "home_login", "admin_login"].includes(item),
    hostname: (item) => item === "pigclaude.com" || item === "admin.pigclaude.com",
    revision: (item) =>
      typeof item === "string" &&
      /^(0|[1-9][0-9]*)$/.test(item) &&
      item.length <= 19 &&
      BigInt(item) <= 9223372036854775807n,
    passed: (item) => typeof item === "boolean",
    step: (item) => typeof item === "string" && submissionPaths.includes(item),
  }
  for (const [key, item] of Object.entries(value)) {
    if (!Object.hasOwn(validators, key)) throw new Error("证据包含未授权字段")
    if (!validators[key](item)) throw new Error("证据字段值无效")
  }
  return { ...value } as ProductionEvidence
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
/** 仅暴露提交编排所需交互，浏览器适配器和本地传输夹具共享同一路径。 */
export interface SubmissionPort {
  /** 等待真实提交控件就绪。 */
  ready(): Promise<void>
  /** 点击前安装响应筛选器，不返回秘密日志。 */
  observe(
    matches: (url: string, method: string) => boolean,
  ): Promise<{ status: number; body: unknown }>
  /** 触发当前表单的真实提交。 */
  click(): Promise<void>
}
const submissionPaths = [
  "/v1/auth/register",
  "/v1/auth/login",
  "/admin/v1/auth/login",
  "/admin/v1/settings/turnstile/draft",
  "/admin/v1/settings/turnstile/activate",
]
/** 固定真实页面允许发出的认证和设置提交路径。 */
export type SubmissionPath =
  | "/v1/auth/register"
  | "/v1/auth/login"
  | "/admin/v1/auth/login"
  | "/admin/v1/settings/turnstile/draft"
  | "/admin/v1/settings/turnstile/activate"
/** 在点击前安装监听器，并按实际命令检查响应与证明边界。 */
export async function performSubmission(
  port: SubmissionPort,
  origin: string,
  path: SubmissionPath,
  status: number,
  previousProof?: string,
): Promise<string | undefined> {
  await port.ready()
  const draft = path === "/admin/v1/settings/turnstile/draft"
  const responsePromise = port.observe(
    (url, method) =>
      new URL(url).origin === origin &&
      new URL(url).pathname === path &&
      method === (draft ? "PUT" : "POST"),
  )
  await port.click()
  const response = await responsePromise
  const body = response.body
  const proof =
    typeof body === "object" && body !== null && "captchaToken" in body
      ? body.captchaToken
      : undefined
  const hasProofField = typeof body === "object" && body !== null && "captchaToken" in body
  if (
    draft
      ? hasProofField
      : !(typeof proof === "string" && proof.length > 0 && proof !== previousProof)
  )
    throw new Error("提交证明边界无效")
  expect(response.status).toBe(status)
  return typeof proof === "string" ? proof : undefined
}
const lastProof = new WeakMap<Page, string>()

/** 等待真实组件可提交并只保留响应状态；不输出请求、proof 或正文。 */
export async function submit(
  page: Page,
  name: string,
  path: SubmissionPath,
  status: number,
): Promise<void> {
  const button = page.getByRole("button", { name, exact: true })
  const proof = await performSubmission(
    {
      ready: async () => {
        await expect(button).toBeEnabled({ timeout: proofTimeout() })
      },
      observe: async (matches) => {
        const response = await page.waitForResponse((response) =>
          matches(response.url(), response.request().method()),
        )
        return { status: response.status(), body: response.request().postDataJSON() as unknown }
      },
      click: async () => {
        await button.click()
      },
    },
    new URL(page.url()).origin,
    path,
    status,
    lastProof.get(page),
  )
  if (proof) lastProof.set(page, proof)
  console.log(
    JSON.stringify(
      safeEvidence({
        step: path,
        status,
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
