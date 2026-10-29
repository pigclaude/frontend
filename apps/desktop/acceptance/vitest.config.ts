// 只在显式选择时运行需要独占双环境的真实客户端验收，不混入默认无服务单元测试。
import { defineConfig } from "vitest/config"

/** 独占验收串行运行，并要求调用方提供受限合成输入和完成标记路径。 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["acceptance/cross-environment-client.test.ts"],
    maxWorkers: 1,
    testTimeout: 30_000,
  },
})
