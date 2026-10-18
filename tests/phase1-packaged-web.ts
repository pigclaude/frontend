// 负责安装版验收所需的真实浏览器注册、管理员授予和设备解绑 UI 操作。
import { expect, type Locator, type Page } from "@playwright/test"
import { randomUUID } from "node:crypto"
import type { ListPlansResponse } from "../packages/api/src/home/types"
import { requiredEnvironment } from "./phase1-packaged-harness"

/** 经真实页面注册、登出再登录独立账号，密码只留内存，返回非秘密用户 ID。 */
export async function registerPackagedUser(page: Page, homeUrl: string): Promise<string> {
  await page.goto(`${homeUrl}/register`)
  const email = `packaged-${randomUUID()}@example.test`
  const password = randomUUID()
  await page.getByLabel("昵称").fill("安装版协议验收")
  await page.getByLabel("邮箱").fill(email)
  await page
    .getByLabel("密码")
    .fill(password)
    .catch(() => {
      throw new Error("注册页密码字段填写失败")
    })
  await page.getByRole("button", { name: "创建账号" }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  const response = await page.request.get(`${homeUrl}/v1/user/me`).catch(() => {
    throw new Error("读取真实用户失败；不记录含 Cookie 的请求错误")
  })
  expect(response.ok()).toBe(true)
  const userId = ((await response.json()) as { id: string }).id
  expect(
    (await page.context().cookies(homeUrl)).some((cookie) => cookie.name === "pigclaude_session"),
  ).toBe(true)
  const status = await page.evaluate(async () => {
    const logout = await fetch("/v1/auth/logout", { method: "POST", credentials: "include" })
    return logout.status
  })
  expect(status).toBe(204)
  await page.reload()
  await expect(page).toHaveURL(/\/login\?redirect=/)
  expect(
    (await page.context().cookies(homeUrl)).some((cookie) => cookie.name === "pigclaude_session"),
  ).toBe(false)
  await page.getByLabel("邮箱").fill(email)
  await page
    .getByLabel("密码")
    .fill(password)
    .catch(() => {
      throw new Error("登录页密码字段填写失败")
    })
  await page.getByRole("button", { name: "登录", exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  expect(
    (await page.context().cookies(homeUrl)).some((cookie) => cookie.name === "pigclaude_session"),
  ).toBe(true)
  return userId
}

/** 经真实管理员登录和人工授予表单激活测试账号会员。 */
export async function grantPackagedMembership(
  page: Page,
  admin: Page,
  homeUrl: string,
  adminUrl: string,
  userId: string,
): Promise<void> {
  const planId = requiredEnvironment("PIGCLAUDE_ACCEPTANCE_PLAN_ID")
  const response = await page.request.get(`${homeUrl}/v1/plans`).catch(() => {
    throw new Error("读取真实套餐失败；不记录含 Cookie 的请求错误")
  })
  expect(response.ok()).toBe(true)
  const plans = (await response.json()) as ListPlansResponse
  const plan = plans.items.find((item) => item.id === planId)
  if (!plan) throw new Error("安装版验收 seed 套餐不存在")
  await admin.goto(`${adminUrl}/login`)
  await admin.getByLabel("账号").fill(requiredEnvironment("PIGCLAUDE_ACCEPTANCE_ADMIN_ACCOUNT"))
  await admin
    .getByLabel("密码")
    .fill(requiredEnvironment("PIGCLAUDE_ACCEPTANCE_ADMIN_PASSWORD"))
    .catch(() => {
      throw new Error("管理员密码字段填写失败")
    })
  await admin.getByRole("button", { name: "登录", exact: true }).click()
  await expect(admin).toHaveURL(/\/users$/)
  await admin.goto(`${adminUrl}/membership`)
  await admin.getByRole("button", { name: "人工授予", exact: true }).click()
  const grant = admin.getByRole("dialog", { name: "人工授予会员" })
  await grant.getByLabel("用户 ID").fill(userId)
  await grant.getByLabel("套餐 ID").fill(planId)
  await grant.getByLabel("条款版本").fill(plan.termsVersion)
  await grant.getByLabel("操作备注").fill("安装版协议真实验收授予")
  await grant.getByRole("button", { name: "确认授予" }).click()
  await expect(grant).not.toBeVisible()
  await expect(await packagedMembershipRow(admin, userId)).toContainText("active")
}

/** 分页定位本次独立账号，避免列表增长使验收错误命中其他用户。 */
export async function packagedMembershipRow(page: Page, userId: string): Promise<Locator> {
  const row = page.getByRole("row").filter({ hasText: userId })
  const next = page.locator(".admin-pager button")
  while (true) {
    await expect(next).toHaveText("下一页")
    if ((await row.count()) > 0) return row
    if (await next.isDisabled()) throw new Error("会员列表中未找到安装版验收用户")
    const previous = await page.locator("tbody").innerText()
    await next.click()
    await expect.poll(() => page.locator("tbody").innerText()).not.toBe(previous)
  }
}

/** 通过真实管理员确认对话框解绑当前测试用户的设备。 */
export async function unbindPackagedDevice(
  admin: Page,
  adminUrl: string,
  userId: string,
): Promise<void> {
  await admin.goto(`${adminUrl}/devices`)
  await admin.getByLabel("设备用户筛选").fill(userId)
  await admin.getByRole("button", { name: "筛选", exact: true }).click()
  await admin
    .getByRole("row")
    .filter({ hasText: userId })
    .getByRole("button", { name: "解绑" })
    .click()
  const unbind = admin.getByRole("dialog", { name: "解绑设备", exact: true })
  await unbind.getByLabel("解绑原因").fill("安装版协议真实验收解绑")
  await unbind.getByRole("button", { name: "确认解绑" }).click()
  await expect(unbind).not.toBeVisible()
}
