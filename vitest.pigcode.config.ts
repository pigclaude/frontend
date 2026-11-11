// 负责拷入的 Pigcode 界面包共用的 Vitest 配置：默认 node 环境、CSS 当空模块（`?raw` 除外）、加载 DOM 补丁。
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

/** 与 Pigcode 根目录配置一致，测试里只有 `?raw` 导入的 CSS 拿到真实文本。 */
export default defineConfig({
  test: {
    environment: "node",
    css: { include: [/\.css\?raw$/] },
    setupFiles: [fileURLToPath(new URL("./pigcode-test-setup.ts", import.meta.url))],
  },
})
