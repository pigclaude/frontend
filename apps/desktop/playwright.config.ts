// 负责配置视觉回归：只启动渲染进程开发服务器，用固定视口和缩放截图。
import { defineConfig } from "@playwright/test"

const port = 5273

export default defineConfig({
  testDir: "./visual",
  testMatch: "*.visual.ts",
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: "light",
    reducedMotion: "reduce",
  },
  webServer: {
    command: "pnpm exec vite --config visual/vite.config.ts",
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
