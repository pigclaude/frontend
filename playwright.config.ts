// 负责只对显式配置的真实服务执行 Chromium 与生产 Electron 验收，禁止保存含凭据的 trace。
import { defineConfig } from "@playwright/test"

// 禁止失败时自动保存含授权 code 链接或表单字段的页面快照。
process.env["PLAYWRIGHT_NO_COPY_PROMPT"] = "1"

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  retries: 0,
  reporter: "line",
  outputDir: "./test-results",
  expect: { timeout: 15_000 },
  use: {
    browserName: "chromium",
    ...(process.env["OAUTH_TEST_BROWSER_WS"]
      ? { connectOptions: { wsEndpoint: process.env["OAUTH_TEST_BROWSER_WS"] } }
      : {}),
    channel: "chromium",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
})
