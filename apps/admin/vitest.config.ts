// 负责配置管理后台 Vitest 的 DOM 环境、源码别名和测试入口。
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

/** 返回管理后台测试配置，保证页面测试使用真实浏览器 DOM 语义。 */
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    // pnpm -r 会同时启动多个应用测试，限制每个 jsdom 应用的文件并发预算。
    maxWorkers: 2,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
})
