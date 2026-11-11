// 负责配置 desktop renderer 的纯状态模型测试；CSS 当空模块，只有 `?raw` 导入拿到真实文本。
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./src/test-support/vitest-setup.ts"],
    include: ["src/renderer/src/**/*.test.ts", "src/main/**/*.test.ts", "src/dev/**/*.test.ts"],
    css: { include: [/\.css\?raw$/] },
  },
})
