// daemon 的 Vitest 配置。代理夹具只被测试导入，不单独收集成测试文件。

import { configDefaults, defineConfig } from "vitest/config"

/** 保证 Vitest 不把代理夹具收集成独立测试文件。 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "src/daemon-proxy-fixture.test.ts"],
    testTimeout: 15_000,
  },
})
