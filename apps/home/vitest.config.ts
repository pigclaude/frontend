// 负责配置 home 页面的 Vitest 测试环境。
import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vitest/config"

/** 配置 home 测试使用浏览器兼容的 DOM 环境及 @/* 源码别名。 */
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
})
