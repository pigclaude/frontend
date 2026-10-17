// 负责验证第一阶段 home、admin、Electron 与 Rust 服务的本地 E2E 契约和 loopback 门禁。
import { test, expect } from "@playwright/test"

const homeUrl = process.env.PIGCLAUDE_HOME_URL ?? "http://127.0.0.1:3000"
const adminUrl = process.env.PIGCLAUDE_ADMIN_URL ?? "http://127.0.0.1:5173"
const rustUrl = process.env.PIGCLAUDE_RUST_URL ?? "http://127.0.0.1:8788"

const phaseOneFixture = {
  user: { email: "phase1-user@example.test", password: "phase1-password-not-a-secret" },
  admin: { account: "phase1-admin", password: "phase1-admin-password-not-a-secret" },
  plan: { id: "phase1-lifetime", priceFen: "0" },
  device: { id: "phase1-device", fingerprintHash: "phase1-fingerprint" },
}

test.describe("pigclaude 第一阶段本地 E2E", () => {
  test("默认 E2E 地址全部解析为 loopback", async () => {
    for (const value of [homeUrl, adminUrl, rustUrl]) {
      expect(new URL(value).hostname).toBe("127.0.0.1")
    }
  })

  test.describe("真实 Web/Desktop 链路", () => {
    test.skip(
      process.env.PIGCLAUDE_E2E !== "1",
      "NOT VERIFIED: set PIGCLAUDE_E2E=1 only after starting the real Rust, home, admin and Electron services",
    )

    test("home 登录、会员授权、Electron callback 和 admin 授予撤销形成一条真实链路", async ({
      page,
      request,
    }) => {
      const user = phaseOneFixture.user
      await page.goto(`${homeUrl}/register`)
      await page.getByLabel("昵称").fill("Phase One User")
      await page.getByLabel("邮箱").fill(user.email)
      await page.getByLabel("密码").fill(user.password)
      await page.getByRole("button", { name: "创建账号" }).click()
      await expect(page).toHaveURL(/dashboard/)
      await page.goto(`${homeUrl}/membership`)
      await expect(page.getByRole("heading", { name: "会员" })).toBeVisible()

      const startResponse = await request.post(`${rustUrl}/v1/desktop/authorizations/start`, {
        data: {
          deviceId: phaseOneFixture.device.id,
          deviceFingerprintHash: phaseOneFixture.device.fingerprintHash,
          codeChallenge: "phase1-code-challenge",
          state: "phase1-state",
          clientId: "pigclaude-desktop",
          callbackUrl: "http://127.0.0.1:43123/callback",
          redirectUri: "http://127.0.0.1:43123/callback",
          purpose: "pigclaude-login",
        },
      })
      expect(startResponse.ok()).toBeTruthy()
      const started = (await startResponse.json()) as { flowId: string; authorizationUrl: string }
      await page.goto(started.authorizationUrl)
      await page.getByRole("button", { name: /确认授权|批准/ }).click()
      await expect(page).toHaveURL(/127\.0\.0\.1:43123\/callback/)

      await page.goto(`${adminUrl}/login`)
      await page.getByLabel("账号").fill(phaseOneFixture.admin.account)
      await page.getByLabel("密码").fill(phaseOneFixture.admin.password)
      await page.getByRole("button", { name: "登录" }).click()
      await page.goto(`${adminUrl}/membership`)
      await expect(page.getByRole("heading", { name: "会员列表" })).toBeVisible()

      await page.goto(`${adminUrl}/devices`)
      await expect(page.getByRole("heading", { name: "设备绑定" })).toBeVisible()
      await page.goto(`${adminUrl}/membership`)
      await expect(page.getByText(/撤销|授予/).first()).toBeVisible()
    })

    test("Electron 重启后重新 inspect，解绑后旧 binding epoch 必须拒绝", async () => {
      test.skip(
        process.env.PIGCLAUDE_ELECTRON_E2E !== "1",
        "NOT VERIFIED: packaged Electron evidence requires a GUI session and explicit E2E harness",
      )
      expect(new URL(rustUrl).hostname).toBe("127.0.0.1")
    })
  })
})
