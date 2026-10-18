// 负责只对显式配置的真实服务执行 Chromium 与生产 Electron 验收，禁止保存含凭据的 trace。
import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  retries: 0,
  reporter: "line",
  outputDir: "./test-results",
  expect: { timeout: 15_000 },
  use: {
    browserName: "chromium",
    channel: "chromium",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
})
