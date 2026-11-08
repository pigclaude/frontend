// 为只验证进程和参数的测试提供合成页面启动操作。

import { FingerprintChromiumAdapter, type FingerprintChromiumConfig } from "./fingerprint-chromium"

/** 创建使用合成子进程的启动器，并保留导航前的取消与条件检查。 */
export function createSyntheticBrowserAdapter(
  config: FingerprintChromiumConfig,
): FingerprintChromiumAdapter {
  return new FingerprintChromiumAdapter({
    ...config,
    openPage: async ({ signal, assertCanNavigate }) => {
      signal?.throwIfAborted()
      assertCanNavigate?.()
    },
  })
}
