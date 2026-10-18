// 负责配置视觉回归：只启动渲染进程开发服务器，用固定视口和缩放截图。
import { defineConfig } from "@playwright/test"

const port = 5273

export default defineConfig({
  testDir: "./visual",
  testMatch: "*.visual.ts",
  // 路径里没有 {platform}：基线是在 macOS 本机按本机字体截的，只能在 macOS 上比对，Linux CI 会失败
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
