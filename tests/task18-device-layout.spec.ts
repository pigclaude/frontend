// 负责在真实 Next/Vite 页面与 Chromium 320px 视口验证设备及治理交互；HTTP fixture 不冒充真实登录验收。
import { test, expect, type Page } from "@playwright/test"
import { writeFile } from "node:fs/promises"
import path from "node:path"
const home = process.env.TASK18_HOME_URL
const admin = process.env.TASK18_ADMIN_URL
const evidence = process.env.TASK18_EVIDENCE_DIR
const id = "pcd_" + "a".repeat(64)
const second = "pcd_" + "b".repeat(64)
const epoch = "9007199254740993"
function device(deviceId = id, displayName = "私有 Mac") {
  return {
    deviceId,
    displayName,
    platform: "macos",
    status: "active",
    bindingEpoch: epoch,
    firstAuthorizedAt: "2026-10-18T00:00:00Z",
    lastSeenAt: "2026-10-19T00:00:00Z",
    isCurrentDevice: null,
  }
}
async function measure(page: Page, name: string) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    )
  })
  const metrics = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    dialogs: [...document.querySelectorAll('[role="dialog"]')].map((node) => ({
      width: node.getBoundingClientRect().width,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    })),
  }))
  expect(metrics.viewport).toBe(320)
  expect(metrics.document).toBeLessThanOrEqual(320)
  expect(metrics.body).toBeLessThanOrEqual(320)
  for (const dialog of metrics.dialogs) {
    expect(dialog.width).toBeLessThanOrEqual(320)
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth)
  }
  if (evidence) {
    await writeFile(
      path.join(evidence, `task-18-browser-${name}.json`),
      JSON.stringify(metrics, null, 2) + "\n",
    )
    await page.screenshot({
      path: path.join(evidence, `task-18-browser-${name}.png`),
      fullPage: true,
    })
  }
  console.log(`Task18 ${name}: ${JSON.stringify(metrics)}`)
}
test.use({ viewport: { width: 320, height: 720 } })
test("Home320: server names, private rename, exact single and all recent-proof UI", async ({
  page,
}) => {
  test.skip(!home, "需要显式 loopback Home URL")
  const writes: { pathname: string; body: Record<string, unknown> }[] = []
  let items = [device(), device(second, "私有 Linux")]
  await page.route("**/v1/**", async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (request.method() !== "GET") {
      const body = request.postDataJSON() as Record<string, unknown>
      writes.push({ pathname, body })
      if (request.method() === "PATCH")
        items[0] = { ...items[0], displayName: String(body.displayName) }
      else if (pathname.endsWith("/revoke")) items = items.filter((item) => item.deviceId !== id)
      else if (pathname.endsWith("/revoke-all")) items = []
      if (pathname.endsWith("/reauth")) {
        await route.fulfill({ json: { type: "verified" } })
        return
      }
      await route.fulfill({ status: 204 })
      return
    }
    const result =
      pathname === "/v1/user/devices"
        ? items
        : pathname === "/v1/user/identities"
          ? [{ provider: "github", display: "github · ••••", canUnlink: true }]
          : pathname === "/v1/auth/captcha"
            ? { enabled: false, provider: "turnstile", mode: "disabled", siteKey: null }
            : pathname === "/v1/session"
              ? { csrf: "fixture-home-csrf" }
              : {
                  id: "42",
                  nickname: "测试用户",
                  email: "masked@example.test",
                  avatar: "",
                  balance: "0",
                  createdAt: "2026-10-18T00:00:00Z",
                  authVersion: "1",
                  status: "active",
                }
    await route.fulfill({ json: result })
  })
  await page.goto(`${home}/settings/devices?currentDeviceId=${id}&identityResult=verified`)
  await expect(page.getByText("私有 Linux", { exact: true })).toBeVisible()
  await expect(page.getByText("当前设备", { exact: true })).toHaveCount(0)
  expect(writes).toHaveLength(0)
  await measure(page, "home-list")
  await page.getByRole("button", { name: "命名 私有 Mac", exact: true }).click()
  await page.getByLabel("设备名称", { exact: true }).fill("我的私有名称")
  await measure(page, "home-rename")
  await page.getByRole("button", { name: "保存名称", exact: true }).click()
  await expect(page.getByText("我的私有名称", { exact: true })).toBeVisible()
  expect(writes[0]).toEqual({
    pathname: `/v1/user/devices/${id}`,
    body: { csrf: "fixture-home-csrf", expectedBindingEpoch: epoch, displayName: "我的私有名称" },
  })
  await page.getByRole("button", { name: "撤销 我的私有名称", exact: true }).click()
  await expect(page.getByRole("button", { name: "使用已绑定 GitHub 核验" })).toBeVisible()
  await page.getByLabel("当前密码", { exact: true }).fill("fixture-password")
  await measure(page, "home-recent")
  await page.getByRole("button", { name: "核验并继续", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByText("私有 Linux", { exact: true })).toBeVisible()
  expect(writes[1].body.action).toEqual({
    operation: "revoke_device",
    device_id: id,
    expected_binding_epoch: epoch,
  })
  await page.getByRole("button", { name: "撤销全部设备", exact: true }).click()
  await page.getByLabel("当前密码", { exact: true }).fill("fixture-password")
  await page.getByRole("button", { name: "核验并继续", exact: true }).click()
  await expect(page.getByText("暂无设备授权记录", { exact: true })).toBeVisible()
  expect(writes[3].body.action).toEqual({ operation: "revoke_all_devices" })
  expect(writes[4]).toEqual({
    pathname: "/v1/user/devices/revoke-all",
    body: { csrf: "fixture-home-csrf" },
  })
  await measure(page, "home-empty")
})
test("Admin320: device-only operator enters known user and revokes an exact relation", async ({
  page,
}) => {
  test.skip(!admin, "需要显式 loopback Admin URL")
  const reads: string[] = []
  const writes: Record<string, unknown>[] = []
  let devices = [device()]
  await page.route("**/admin/v1/**", async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (request.method() === "POST") {
      writes.push(request.postDataJSON() as Record<string, unknown>)
      devices = []
      await route.fulfill({ status: 204 })
      return
    }
    reads.push(pathname)
    await route.fulfill({
      json: pathname.endsWith("/me")
        ? {
            id: "a1",
            account: "device operator",
            status: "active",
            permissions: ["device:read", "device:revoke"],
          }
        : pathname.endsWith("/session")
          ? { csrf: "fixture-admin-csrf" }
          : { authVersion: epoch, devices },
    })
  })
  await page.goto(`${admin}/devices`)
  await page.getByLabel("设备用户筛选", { exact: true }).fill("42")
  await page.getByRole("button", { name: "筛选", exact: true }).click()
  await expect(page.getByText("私有 Mac", { exact: true })).toBeVisible()
  expect(reads).not.toContain("/admin/v1/users")
  await measure(page, "admin-devices")
  await page.getByRole("button", { name: "撤销 私有 Mac", exact: true }).click()
  await page.getByLabel("操作原因", { exact: true }).fill("  操作原因原样  ")
  await measure(page, "admin-device-reason")
  await page.getByRole("button", { name: "确认撤销", exact: true }).click()
  await expect(page.getByText("暂无设备授权记录", { exact: true })).toBeVisible()
  expect(writes).toEqual([
    {
      csrf: "fixture-admin-csrf",
      expectedBindingEpoch: epoch,
      expectedAuthVersion: epoch,
      reason: "  操作原因原样  ",
    },
  ])
})
test("Admin320: account status filter and server-authoritative ban/unban UI", async ({ page }) => {
  test.skip(!admin, "需要显式 loopback Admin URL")
  let status = "active"
  let authVersion = epoch
  const writes: { pathname: string; body: Record<string, unknown> }[] = []
  const user = () => ({
    id: "42",
    nickname: "目标用户",
    email: "masked@example.test",
    avatar: "",
    githubLogin: "",
    status,
    authVersion,
    balance: "0",
    createdAt: "2026-10-18T00:00:00Z",
    lastLoginAt: null,
  })
  await page.route("**/admin/v1/**", async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (request.method() === "POST") {
      writes.push({ pathname, body: request.postDataJSON() as Record<string, unknown> })
      status = pathname.endsWith("/ban") ? "banned" : "active"
      authVersion = "9007199254740994"
      await route.fulfill({ json: { userId: "42", status, authVersion } })
      return
    }
    await route.fulfill({
      json: pathname.endsWith("/me")
        ? {
            id: "a1",
            account: "moderator",
            status: "active",
            permissions: ["users:read", "users:ban", "users:unban", "users:sessions:revoke"],
          }
        : pathname.endsWith("/session")
          ? { csrf: "fixture-admin-csrf" }
          : { items: [user()], nextCursor: "0" },
    })
  })
  await page.goto(`${admin}/users`)
  await page.getByLabel("账号状态", { exact: true }).selectOption("active")
  await expect(page.getByText("目标用户", { exact: true })).toBeVisible()
  await measure(page, "admin-users")
  await page.getByRole("button", { name: "详情", exact: true }).click()
  await page.getByRole("button", { name: "封禁账号", exact: true }).click()
  await page.getByLabel("操作原因", { exact: true }).fill("  核实后封禁  ")
  await measure(page, "admin-moderation")
  await page.getByRole("button", { name: "确认封禁", exact: true }).click()
  await page.getByRole("button", { name: "解封账号", exact: true }).click()
  await expect(
    page.getByText("解封不会恢复旧登录、旧令牌或旧授权。用户需要重新认证。", { exact: true }),
  ).toBeVisible()
  await page.getByLabel("操作原因", { exact: true }).fill("审核解封")
  await page.getByRole("button", { name: "确认解封", exact: true }).click()
  await expect(
    page.getByText("账号已解封，旧登录不会恢复，用户需要重新认证。", { exact: true }),
  ).toBeVisible()
  expect(writes[0]).toEqual({
    pathname: "/admin/v1/users/42/ban",
    body: { csrf: "fixture-admin-csrf", expectedAuthVersion: epoch, reason: "  核实后封禁  " },
  })
  expect(writes[1].body.expectedAuthVersion).toBe("9007199254740994")
})
