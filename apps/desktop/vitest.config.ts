// 负责配置 desktop renderer 的纯状态模型测试。
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/renderer/src/**/*.test.ts", "src/main/**/*.test.ts"],
  },
})
