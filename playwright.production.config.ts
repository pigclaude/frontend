// 负责生产独立门禁：仅 headed Chromium，禁用秘密快照，浏览器环境使用非秘密白名单。
import { defineConfig } from "@playwright/test"

process.env["PLAYWRIGHT_NO_COPY_PROMPT"] = "1"
for (const name of [
  "ADMIN_ACCOUNT",
  "ADMIN_PASSWORD",
  "READONLY_ACCOUNT",
  "READONLY_PASSWORD",
  "SITE_KEY",
  "SECRET_KEY",
  "USER_EMAIL",
  "USER_PASSWORD",
]) {
  if (!process.env[`PIGCLAUDE_ACCEPTANCE_${name}`])
    throw new Error(`生产门禁缺少 PIGCLAUDE_ACCEPTANCE_${name}，NOT VERIFIED`)
}
const browserEnv: Record<string, string> = {}
for (const key of [
  "PATH",
  "HOME",
  "TMPDIR",
  "DISPLAY",
  "XAUTHORITY",
  "LANG",
  "LC_ALL",
  "SYSTEMROOT",
]) {
  const value = process.env[key]
  if (value) browserEnv[key] = value
}
export default defineConfig({
  testDir: "./tests",
  testMatch: "turnstile-production.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 1_800_000,
  reporter: "line",
  outputDir: "./test-results/production",
  expect: { timeout: 15_000 },
  use: {
    browserName: "chromium",
    headless: false,
    trace: "off",
    video: "off",
    screenshot: "off",
    launchOptions: { env: browserEnv },
  },
})
