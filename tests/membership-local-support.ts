// 负责任务专属真实浏览器付款、管理员配置、数据库读回及会话过期验收；不保存认证材料。
import { expect, type Page } from "@playwright/test"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
const root = resolve(process.cwd(), "..")
const plan = resolve(root, ".superpowers/sdd/2026-10-22-pigclaude-membership-tiers-payment")
/** 仅允许本计划私有运行信息与脱敏证据目录。 */
export const config = JSON.parse(
  readFileSync(resolve(plan, "task-17-runtime.private.json"), "utf8"),
) as {
  home: string
  admin: string
  gateway: string
  gatewayKey: string
  gatewayPid: string
  schema: string
  database: string
}
/** 仅允许本计划私有运行信息与脱敏证据目录。 */
export const evidence = resolve(
  root,
  "docs/verification/2026-10-22-membership-tiers-payment-evidence",
)
mkdirSync(evidence, { recursive: true })
if (
  !/^settings_test_[a-f0-9]{32}$/.test(config.schema) ||
  !/^pigclaude_oauth_test_[a-f0-9]+$/.test(config.database)
)
  throw new Error("OWNERSHIP_REQUIRED")
const records: Record<string, unknown> = {
  ...(existsSync(resolve(evidence, "database-and-browser.json"))
    ? JSON.parse(readFileSync(resolve(evidence, "database-and-browser.json"), "utf8"))
    : {}),
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
      "pigclaude-membership-pg",
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
export async function pay(page: Page, name: string, email: string, free = false) {
  await screenshot(page, `${name}-selection`, true)
  await page.getByRole("button", { name: "创建订单", exact: true }).click()
  if (!free) {
    await expect(page.getByLabel("付款二维码")).toBeVisible()
    await screenshot(page, `${name}-qr`, true)
    const order = sql(
      `SELECT order_no FROM payment_orders o JOIN users u ON u.id=o.user_id WHERE u.email='${email}' AND o.status='pending'`,
    )
    expect(order).toMatch(/^PC[0-9A-Z]{20}$/)
    const response = await fetch(`${config.gateway}/__pay?order=${order}`, {
      method: "POST",
      redirect: "manual",
    })
    expect(response.status).toBe(200)
  }
  await expect(page.getByText("支付成功，会员已生效", { exact: true })).toBeVisible()
  await screenshot(page, `${name}-success`, true)
  await page.getByRole("button", { name: "关闭", exact: true }).click()
  return readback(name, email)
}
