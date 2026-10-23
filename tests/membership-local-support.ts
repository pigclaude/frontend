// 负责任务专属真实浏览器付款、管理员配置、数据库读回及会话过期验收；不保存认证材料。
import { expect, type Page, type Browser, type BrowserContextOptions } from "@playwright/test"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
const root = resolve(process.cwd(), "..")
const plan = resolve(root, ".superpowers/sdd/2026-10-23-pigclaude-membership-experience")
/** 仅允许本计划私有运行信息与脱敏证据目录。 */
export const config = JSON.parse(
  readFileSync(resolve(plan, "task-15-runtime.private.json"), "utf8"),
) as {
  owner: string
  runId: string
  evidence: string
  browserWs: string
  postgresContainer: string
  home: string
  admin: string
  gateway: string
  gatewayKey: string
  gatewayPid: string
  schema: string
  database: string
}
/** 仅允许本计划私有运行信息与脱敏证据目录。 */
export const evidence = config.evidence
mkdirSync(evidence, { recursive: true })
if (
  config.owner !== "2026-10-23-membership-experience" ||
  config.postgresContainer !== "pigclaude-experience-pg" ||
  !/^t15-[0-9]+-[a-f0-9]{8}$/.test(config.runId) ||
  !/^settings_test_[a-f0-9]{32}$/.test(config.schema) ||
  !/^pigclaude_oauth_test_[a-f0-9]+$/.test(config.database)
)
  throw new Error("OWNERSHIP_REQUIRED")
const records: Record<string, unknown> = {
  executedAt: new Date().toISOString(),
  database: config.database,
  schema: config.schema,
}
/** 在本任务限定资源内执行验收，并只记录业务字段。 */
export function sql(query: string) {
  return execFileSync(
    "docker",
    [
      "exec",
      config.postgresContainer,
      "psql",
      "-U",
      "postgres",
      "-d",
      config.database,
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `SET search_path TO ${config.schema}; ${query}`,
    ],
    { encoding: "utf8" },
  ).trim()
}
/** 在本任务限定资源内执行验收，并只记录业务字段。 */
export function record(name: string, value: unknown) {
  let prior: Record<string, unknown> = {}
  try {
    prior = JSON.parse(
      readFileSync(resolve(evidence, "database-and-browser.json"), "utf8"),
    ) as Record<string, unknown>
  } catch {
    /* 本轮首次写入。 */
  }
  Object.assign(records, prior)
  records.executedAt = new Date().toISOString()
  records[name] = value
  writeFileSync(resolve(evidence, "database-and-browser.json"), JSON.stringify(records, null, 2))
  console.log(`ACCEPTANCE ${name}`)
}
/** 在本任务限定资源内执行验收，并只记录业务字段。 */
export function readback(name: string, email: string) {
  const value = JSON.parse(
    sql(
      `SELECT json_build_object('membership',(SELECT row_to_json(m) FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email='${email}'),'orders',(SELECT json_agg(o ORDER BY o.created_at) FROM payment_orders o JOIN users u ON u.id=o.user_id WHERE u.email='${email}'),'segments',(SELECT json_agg(s ORDER BY s.id) FROM membership_segments s JOIN users u ON u.id=s.user_id WHERE u.email='${email}'))`,
    ),
  ) as {
    membership: { valid_until: string; tier_id: string }
    orders: {
      order_no: string
      status: string
      kind: string
      payable_fen: number
      credit_fen: number
      duration_seconds: number
    }[]
  }
  record(name, value)
  return value
}
/** 通过真实页面完成本地动作，截图不包含认证材料。 */
export async function screenshot(page: Page, name: string, dialog = false) {
  const area = dialog ? page.getByRole("dialog") : page.locator("main").first()
  await expect(area).toBeVisible()
  await area.screenshot({ path: resolve(evidence, `${name}.png`) })
}
/** 通过真实页面完成本地动作，截图不包含认证材料。 */
export async function goto(page: Page, url: string) {
  await page.goto(url).catch(() => {
    throw new Error("LOCAL_NAVIGATION_FAILED")
  })
}
/** 通过真实页面完成本地动作，截图不包含认证材料。 */
export async function login(page: Page, email: string, admin = false, register = false) {
  await goto(page, `${admin ? config.admin : config.home}/${register ? "register" : "login"}`)
  await page.getByLabel("邮箱", { exact: true }).fill(email)
  await page.getByLabel("密码", { exact: true }).fill("runtime-password")
  await page.getByRole("button", { name: register ? "创建账号" : "登录", exact: true }).click()
  await page.waitForURL((url) => url.pathname === (admin ? "/users" : "/dashboard"))
}
/** 通过真实页面完成本地动作，截图不包含认证材料。 */
export async function pay(
  page: Page,
  name: string,
  email: string,
  cta: string,
  tier: string,
  free = false,
) {
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/membership/orders") && response.request().method() === "POST",
  )
  await page.getByRole("button", { name: cta, exact: true }).click()
  if (free) await page.getByRole("button", { name: "确认升级", exact: true }).click()
  const response = await created
  expect(response.status()).toBe(200)
  const body = (await response.json()) as { order: { orderNo: string }; orderNo?: string }
  const order = body.order?.orderNo ?? body.orderNo
  expect(order).toMatch(/^PC[0-9A-Z]{20}$/)
  record(`${name}-created`, body)
  const panel = page.getByRole("dialog", { name: "会员支付" })
  if (!free) {
    await expect(panel.getByLabel("付款二维码")).toBeVisible()
    await screenshot(page, `${name}-qr`, true)
    const paid = await fetch(`${config.gateway}/__pay?order=${order}`, {
      method: "POST",
      redirect: "manual",
    })
    expect(paid.status).toBe(200)
    await panel.getByRole("button", { name: "我已完成支付", exact: true }).click()
  }
  await expect(panel.getByRole("status").filter({ hasText: `${tier} 已生效` })).toBeVisible()
  await screenshot(page, `${name}-success`, true)
  await panel.getByRole("button", { name: "完成", exact: true }).click()
  return readback(name, email)
}
/** 通过真实等级与时长单选控件选择服务端报价。 */
export async function selectOffer(page: Page, tier: string, months: number) {
  await page
    .getByRole("radiogroup", { name: "会员等级" })
    .getByRole("radio", { name: new RegExp(`^${tier}\\b`) })
    .click()
  await page
    .getByRole("radiogroup", { name: "购买时长" })
    .getByRole("radio", { name: new RegExp(`^${months} 个月`) })
    .click()
}

/** 每个上下文只允许本轮正式站点和网关，native回调由其专属helper精确注册。 */
export async function ownedContext(browser: Browser, options: BrowserContextOptions = {}) {
  const context = await browser.newContext(options)
  context.setDefaultTimeout(20_000)
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url())
    return [config.home, config.admin, config.gateway].includes(url.origin) ||
      url.protocol === "data:"
      ? route.continue()
      : route.abort()
  })
  return context
}
