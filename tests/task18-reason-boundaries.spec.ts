// 负责以真实 Vite 页面原生批量输入和 HTTP 提交证明旧理由长度与新治理 Unicode 边界，不操作 OS 剪贴板。
import { test, expect } from "@playwright/test"
const admin = process.env.TASK18_ADMIN_URL
const member = {
  userId: "42",
  status: "active",
  email: "member@example.test",
  tier: { code: "vip", name: "VIP", level: 1 },
  validUntil: "2026-10-30T00:00:00Z",
  entitlementVersion: "1",
}
test("default membership reason retains native 200 UTF-16 insertion limit and trimmed HTTP submission", async ({
  page,
}) => {
  test.skip(!admin, "需要显式 loopback Admin URL")
  const writes: { path: string; body: unknown }[] = []
  await page.route("**/admin/v1/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === "POST") {
      writes.push({ path, body: request.postDataJSON() })
      await route.fulfill({
        json: {
          status: "revoked",
          tier: member.tier,
          validUntil: member.validUntil,
          remainingSeconds: "0",
          entitlementVersion: "2",
        },
      })
      return
    }
    await route.fulfill({
      json: path.endsWith("/me")
        ? {
            id: "a1",
            account: "member operator",
            status: "active",
            email: "member@example.test",
            tier: { code: "vip", name: "VIP", level: 1 },
            permissions: ["membership:read", "membership:write"],
          }
        : path.endsWith("/session")
          ? { csrf: "fixture-csrf" }
          : { items: [member], nextCursor: null },
    })
  })
  await page.goto(`${admin}/membership`)
  await page.getByRole("button", { name: "撤销", exact: true }).click()
  const input = page.getByLabel("原因", { exact: true })
  await input.focus()
  await page.keyboard.insertText("x".repeat(201))
  await expect(input).toHaveValue("x".repeat(200))
  await expect(page.getByRole("button", { name: "确认", exact: true })).toBeEnabled()
  await input.fill("")
  await input.focus()
  await page.keyboard.insertText("😀".repeat(101))
  await expect(input).toHaveValue("😀".repeat(100))
  await expect(page.getByRole("button", { name: "确认", exact: true })).toBeEnabled()
  await input.fill("  会员撤销原因  ")
  await page.getByRole("button", { name: "确认", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(writes).toEqual([
    { path: "/admin/v1/memberships/42/revoke", body: { reason: "会员撤销原因" } },
  ])
})
test("explicit governance accepts 500 Unicode characters, rejects 501 and preserves original reason", async ({
  page,
}) => {
  test.skip(!admin, "需要显式 loopback Admin URL")
  const writes: unknown[] = []
  await page.route("**/admin/v1/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === "POST") {
      writes.push(request.postDataJSON())
      await route.fulfill({ json: { userId: "42", status: "banned", authVersion: "2" } })
      return
    }
    await route.fulfill({
      json: path.endsWith("/me")
        ? {
            id: "a1",
            account: "moderator",
            status: "active",
            email: "member@example.test",
            tier: { code: "vip", name: "VIP", level: 1 },
            permissions: ["users:read", "users:ban"],
          }
        : path.endsWith("/session")
          ? { csrf: "fixture-csrf" }
          : {
              items: [
                {
                  id: "42",
                  nickname: "目标用户",
                  email: "masked@example.test",
                  status: "active",
                  email: "member@example.test",
                  tier: { code: "vip", name: "VIP", level: 1 },
                  authVersion: "1",
                  avatar: "",
                  githubLogin: "",
                  balance: "0",
                  createdAt: "2026-10-18T00:00:00Z",
                  lastLoginAt: null,
                },
              ],
              nextCursor: null,
            },
    })
  })
  await page.goto(`${admin}/users`)
  await page.getByRole("button", { name: "详情", exact: true }).click()
  await page.getByRole("button", { name: "封禁账号", exact: true }).click()
  const input = page.getByLabel("操作原因", { exact: true })
  await input.focus()
  await page.keyboard.insertText("x".repeat(501))
  await expect(input).toHaveValue("x".repeat(501))
  await expect(page.getByRole("button", { name: "确认封禁", exact: true })).toBeDisabled()
  expect(writes).toHaveLength(0)
  const reason = " " + "😀".repeat(498) + " "
  await input.fill("")
  await input.focus()
  await page.keyboard.insertText(reason)
  await expect(input).toHaveValue(reason)
  await expect(page.getByRole("button", { name: "确认封禁", exact: true })).toBeEnabled()
  await page.getByRole("button", { name: "确认封禁", exact: true }).click()
  await expect(page.getByRole("dialog", { name: "封禁账号", exact: true })).toHaveCount(0)
  expect(writes).toEqual([{ csrf: "fixture-csrf", expectedAuthVersion: "1", reason }])
})
