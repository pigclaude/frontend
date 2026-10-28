// 负责验证恢复页及个人设置的撤销确认在四种外观下可达，最大字号下取消不发出撤销命令。
import { expect, test } from "@playwright/test"
import type { DeviceWithdrawalConfirmation } from "@pigclaude/contracts/desktop-membership"
import type { MembershipView } from "@pigclaude/contracts/membership"

type MembershipCommand = "prepare" | "withdraw"

declare global {
  /** 视觉测试只观察 renderer 通过公开会员桥发出的命令。 */
  interface Window {
    /** 将桥接命令传回 Playwright，验证取消不会触发撤销。 */
    recordVisualMembershipCall: (command: MembershipCommand, target: string) => Promise<void>
  }
}

for (const screen of ["login", "profile"] as const) {
  for (const theme of ["light", "dark"]) {
    for (const glass of [0, 1]) {
      test(`withdrawal layout ${screen} ${theme} glass=${glass}`, async ({ page }, testInfo) => {
        const recovery = screen === "login"
        const width = recovery ? 420 : 1200
        const height = recovery ? 720 : 800
        const calls: Array<{ command: MembershipCommand; target: string }> = []
        const account = {
          userId: "fixture-user",
          nickname: "布局验收用户",
          email: "long-address-for-layout-check@example.test",
          avatar: "",
        }
        const membership: MembershipView = {
          actionContextId: "visual-context",
          startupPhase: "settled",
          revision: 1,
          state: recovery ? "verification_required" : "active",
          account,
          tier: null,
          membershipValidUntil: null,
          offlineValidUntil: null,
          lastVerifiedAt: null,
          nextVerificationAt: null,
          bindingEpoch: "2",
          errorCode: recovery ? "AUTHORIZATION_REQUIRED" : null,
          serverReason: null,
          authorizationUrl: null,
          recovery: { status: "active", grantExpiresAt: "2030-01-01T00:00:00Z", canRevoke: true },
        }
        const confirmation: DeviceWithdrawalConfirmation = {
          confirmationId: "visual-confirmation",
          account: { nickname: account.nickname, email: account.email },
          expiresAt: "2030-01-01T00:00:00Z",
        }
        await page.exposeFunction(
          "recordVisualMembershipCall",
          (command: MembershipCommand, target: string) => {
            calls.push({ command, target })
          },
        )
        await page.setViewportSize({ width, height })
        await page.addInitScript(
          ({ membership: view, confirmation: prepared, uiSize }) => {
            localStorage.setItem("pigclaude-appearance", JSON.stringify({ version: 1, uiSize }))
            const signedOut: MembershipView = {
              ...view,
              revision: view.revision + 1,
              state: "signed_out",
              actionContextId: undefined,
              recovery: undefined,
              account: null,
              bindingEpoch: null,
              errorCode: null,
            }
            const bridge: NonNullable<Window["pigclaude"]> = {
              platform: "darwin",
              membership: {
                inspect: async () => view,
                subscribe: () => () => {},
                signOut: async () => signedOut,
                prepareWithdrawal: async (contextId) => {
                  await window.recordVisualMembershipCall("prepare", contextId)
                  if (contextId !== view.actionContextId) throw new Error("Unexpected context")
                  return prepared
                },
                withdraw: async (confirmationId) => {
                  await window.recordVisualMembershipCall("withdraw", confirmationId)
                  if (confirmationId !== prepared.confirmationId)
                    throw new Error("Unexpected confirmation")
                  return signedOut
                },
              },
            }
            window.pigclaude = bridge
          },
          { membership, confirmation, uiSize: recovery ? 18 : 13 },
        )
        await page.goto(`/?screen=${screen}&theme=${theme}&glass=${glass}`)
        const title = recovery ? "设备需要重新授权" : "我的账户"
        await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible()
        if (recovery) {
          const panel = page.getByRole("region", { name: title })
          const explanation = panel.getByText(
            "当前设备的使用权限需要重新确认，请在浏览器中继续。",
            { exact: true },
          )
          await explanation.scrollIntoViewIfNeeded()
          await expect(explanation).toBeInViewport()
          for (const name of ["重新授权", "切换账号", "重新检查", "更多操作"]) {
            const button = panel.getByRole("button", { name, exact: true })
            await button.scrollIntoViewIfNeeded()
            await expect(button).toBeInViewport()
            await expect(button).toBeEnabled()
          }
        }
        expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: testInfo.outputPath("entry.png") })
        if (recovery) {
          await page.getByRole("button", { name: "更多操作", exact: true }).click()
          const item = page.getByRole("menuitem", { name: "撤销本机授权", exact: true })
          await expect(item).toBeInViewport()
          await item.click()
        } else {
          await page.getByRole("button", { name: "撤销本机授权", exact: true }).click()
        }
        const dialog = page.getByRole("dialog", { name: "撤销本机授权？", exact: true })
        await expect(dialog).toBeVisible()
        await expect(dialog.getByText(/全部相关桌面授权/)).toBeVisible()
        await expect(dialog.getByText(/其他设备、同机其他网站账号、网站登录会话/)).toBeVisible()
        await expect(dialog.getByText(/账号、凭据、代理和指纹均保留/)).toBeVisible()
        await expect(
          dialog.getByText(`${confirmation.account.nickname} ${confirmation.account.email}`, {
            exact: true,
          }),
        ).toBeVisible()
        for (const name of ["取消", "确认撤销"]) {
          const button = dialog.getByRole("button", { name, exact: true })
          await expect(button).toBeInViewport()
          await expect(button).toBeEnabled()
        }
        const bounds = await dialog.boundingBox()
        expect(
          bounds &&
            bounds.x >= 0 &&
            bounds.y >= 0 &&
            bounds.x + bounds.width <= width &&
            bounds.y + bounds.height <= height,
        ).toBe(true)
        expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: testInfo.outputPath("confirmation.png") })
        await dialog.getByRole("button", { name: "取消", exact: true }).click()
        await expect(dialog).not.toBeVisible()
        await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible()
        expect(calls).toEqual([{ command: "prepare", target: "visual-context" }])
      })
    }
  }
}
