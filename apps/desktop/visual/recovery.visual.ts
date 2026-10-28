// 负责从真实 renderer 入口验证恢复原因在主题、窄窗口及最大字号下仍清楚可达。
import { expect, test } from "@playwright/test"
import type { MembershipView } from "@pigclaude/contracts/membership"

const cases = [
  { state: "verification_required", status: "none", title: "尚未开通会员" },
  { state: "expired", status: "expired", title: "会员已到期" },
  { state: "verification_required", status: "revoked", title: "会员已停用" },
  { state: "device_revoked", status: null, title: "设备授权已撤销" },
  { state: "error", status: null, title: "暂时无法验证" },
] as const
for (const width of [420, 1200]) {
  for (const theme of ["light", "dark"]) {
    for (const glass of [0, 1]) {
      test(`recovery ${width} ${theme} glass=${glass}`, async ({ context }, testInfo) => {
        for (const { state, status, title } of cases) {
          const page = await context.newPage()
          await page.setViewportSize({ width, height: width === 420 ? 720 : 800 })
          const view: MembershipView = {
            actionContextId: "visual-context",
            startupPhase: "settled",
            revision: 1,
            state,
            account: status
              ? {
                  userId: "fixture-user",
                  nickname: "恢复测试用户",
                  email: "long-address-for-layout-check@example.test",
                  avatar: "",
                }
              : null,
            tier: status === "expired" ? { code: "vip", name: "VIP", level: 1 } : null,
            membershipValidUntil: status === "expired" ? "2026-01-01T00:00:00Z" : null,
            offlineValidUntil: null,
            lastVerifiedAt: null,
            nextVerificationAt: null,
            bindingEpoch: "1",
            errorCode: null,
            serverReason: null,
            authorizationUrl: null,
            ...(status
              ? {
                  recovery: {
                    status,
                    grantExpiresAt: "2030-01-01T00:00:00Z",
                    canRevoke: true,
                  },
                }
              : {}),
          }
          await page.addInitScript((membership) => {
            localStorage.setItem("pigclaude-appearance", JSON.stringify({ version: 1, uiSize: 18 }))
            window.pigclaude = {
              platform: "darwin",
              membership: {
                openWebsite: async () => undefined,
                prepareWithdrawal: async () => ({
                  confirmationId: "visual-confirmation",
                  account: {
                    nickname: "恢复测试用户",
                    email: "long-address-for-layout-check@example.test",
                  },
                  expiresAt: "2030-01-01T00:00:00Z",
                }),
                inspect: async () => membership,
                subscribe: () => () => {},
                withdraw: async () => membership,
                signOut: async () => membership,
              },
            }
          }, view)
          await page.goto(`/?screen=login&theme=${theme}&glass=${glass}`)
          await expect(
            page.getByRole("heading", { level: 1, name: title, exact: true }),
          ).toBeVisible()
          const check = page.getByRole("button", { name: "重新检查", exact: true })
          await check.scrollIntoViewIfNeeded()
          await expect(check).toBeInViewport()
          expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true)
          if (status) {
            await page.getByRole("button", { name: "更多操作", exact: true }).click()
            await page.getByRole("menuitem", { name: "撤销本机授权", exact: true }).click()
            const dialog = page.getByRole("dialog")
            await expect(dialog).toBeVisible()
            await expect(dialog.getByText(/全部相关桌面授权/)).toBeVisible()
            await expect(
              dialog.getByRole("button", { name: "确认撤销", exact: true }),
            ).toBeInViewport()
            const bounds = await dialog.boundingBox()
            expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width).toBe(true)
            if (status === "expired")
              await page.screenshot({ path: testInfo.outputPath("withdrawal-confirmation.png") })
            await dialog.getByRole("button", { name: "取消", exact: true }).click()
            await expect(dialog).not.toBeVisible()
          }
          await page.close()
        }
      })
    }
  }
}
