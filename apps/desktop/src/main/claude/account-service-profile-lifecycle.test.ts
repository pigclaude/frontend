// 验证活动授权的配置使用权，以及外部配置变更后的证据失效。

import { expect, it } from "vitest"
import { createHarness, fingerprint, seedAccount } from "./account-service-test-fixtures"

it("授权期间拒绝配置编辑，外部配置变化仍使本轮报告失效", async () => {
  let resolveCode: (code: string) => void = () => undefined
  let complete = false
  const code = new Promise<string>((resolve) => {
    resolveCode = (value) => {
      complete = true
      resolve(value)
    }
  })
  const callback = {
    redirectUri: "http://localhost:1234/callback",
    isComplete: () => complete,
    waitForCode: () => code,
    cancel: () => undefined,
    close: async () => undefined,
  }
  const harness = await createHarness({
    callback,
    profile: {
      accountUuid: "old-account",
      email: "old@example.com",
      organizationUuid: "org",
      subscriptionType: "max",
      rateLimitTier: null,
    },
  })
  await harness.store.saveAccount(seedAccount())
  await harness.store.saveProxy({
    schemaVersion: 1,
    id: "p2",
    name: "p2",
    url: "http://127.0.0.1:2",
    lastTest: null,
  })
  const authorization = harness.service
    .authorize({
      accountId: "acc-1",
      displayName: "授权名称",
      proxyId: null,
      fingerprint,
    })
    .catch((error: unknown) => error)
  await harness.launched.promise
  await expect(
    harness.service.update({
      accountId: "acc-1",
      displayName: "并发修改",
      proxyId: "p2",
      fingerprint: { ...fingerprint, seed: "999" },
    }),
  ).rejects.toThrow("请先结束")
  const original = await harness.store.getBrowserProfile("acc-1")
  if (!original) throw new Error("合成配置不存在")
  await harness.store.saveBrowserProfile({
    ...original,
    proxyId: "p2",
    fingerprint: { ...original.fingerprint, seed: "999" },
    revision: original.revision + 1,
  })
  resolveCode("synthetic-code")
  expect(await authorization).toMatchObject({ code: "ENVIRONMENT_CHECK_FAILED" })
  expect(await harness.store.getAccount("acc-1")).toMatchObject({
    displayName: "旧账号",
    proxyId: "p2",
    fingerprint: { seed: "999" },
    credential: { accessToken: "old-access" },
  })
})
