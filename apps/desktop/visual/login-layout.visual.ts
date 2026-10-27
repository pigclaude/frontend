// 负责通过可访问界面验证登录四态在主题、窄窗口和最大字号下的可读性与操作可达性。
import { expect, test } from "@playwright/test"
import type { MembershipView } from "@pigclaude/contracts/membership"

const states = [
  { phase: "idle", title: "欢迎使用 PigClaude", actions: ["登录", "注册"] },
  {
    phase: "waiting",
    title: "请在浏览器中继续",
    actions: ["重新打开浏览器", "复制链接", "取消"],
  },
  { phase: "confirming", title: "正在确认会员…", actions: [] },
  { phase: "error", title: "浏览器授权未完成", actions: ["重新授权", "返回"] },
] as const

for (const width of [420, 1200]) {
  for (const theme of ["light", "dark"]) {
    for (const glass of [0, 1]) {
      for (const uiSize of [13, 18]) {
        test(`login layout ${width} ${theme} glass=${glass} uiSize=${uiSize}`, async ({ page }) => {
          await page.setViewportSize({ width, height: width === 420 ? 720 : 800 })
          await page.addInitScript((size) => {
            localStorage.setItem(
              "pigclaude-appearance",
              JSON.stringify({ version: 1, uiSize: size }),
            )
          }, uiSize)
          for (const { phase, title, actions } of states) {
            await page.goto(`/?screen=login&phase=${phase}&theme=${theme}&glass=${glass}`)
            const panel = page.getByRole("region", { name: title })
            await expect(panel).toBeVisible()
            await expect(panel.getByRole("heading", { level: 1, name: title })).toBeVisible()
            for (const action of actions) {
              const button = panel.getByRole("button", { name: action, exact: true })
              await button.scrollIntoViewIfNeeded()
              await expect(button).toBeInViewport()
              await expect(button).toBeEnabled()
            }
            if (phase === "confirming") {
              await expect(panel.getByRole("status")).toContainText("正在确认会员…")
              await expect(panel.getByRole("button")).toHaveCount(0)
            }
            expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true)
          }
        })
      }
    }
  }
}

test("login notices and withdraw remain reachable in a narrow window at maximum font size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 420, height: 720 })
  const view: MembershipView = {
    startupPhase: "settled",
    revision: 1,
    state: "verification_required",
    account: { userId: "fixture", nickname: "", email: "", avatar: "" },
    tier: null,
    membershipValidUntil: null,
    offlineValidUntil: null,
    lastVerifiedAt: null,
    nextVerificationAt: null,
    bindingEpoch: "2",
    errorCode: "AUTHORIZATION_REQUIRED",
    serverReason: null,
    authorizationUrl: null,
  }
  await page.addInitScript((membership) => {
    localStorage.setItem("pigclaude-appearance", JSON.stringify({ version: 1, uiSize: 18 }))
    window.pigclaude = {
      platform: "darwin",
      membership: {
        inspect: async () => membership,
        subscribe: () => () => {},
        signOut: async () => membership,
        withdraw: async () => membership,
      },
    }
  }, view)
  await page.goto("/?screen=login&theme=dark&glass=1")
  const panel = page.getByRole("region", { name: "欢迎使用 PigClaude" })
  await expect(panel.getByRole("status")).toBeVisible()
  for (const name of ["撤销本机授权", "登录", "注册"]) {
    const button = panel.getByRole("button", { name, exact: true })
    await button.scrollIntoViewIfNeeded()
    await expect(button).toBeInViewport()
    await expect(button).toBeEnabled()
  }
  expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true)
})
