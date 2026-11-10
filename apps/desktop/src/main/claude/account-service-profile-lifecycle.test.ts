// 验证活动授权的配置使用权，以及外部配置变更后的证据失效。

import { expect, it } from "vitest"
import { createHarness, fingerprint, seedAccount } from "./account-service-test-fixtures"
import { deferred } from "../testing/profile-fixture"

it("凭据提交时再次核对引用身份，内容相同的晚到改绑不覆盖旧凭据", async () => {
  const harness = await createHarness({
    profile: {
      accountUuid: "old-account",
      email: "old@example.com",
      organizationUuid: "org",
      subscriptionType: "max",
      rateLimitTier: null,
    },
  })
  try {
    await harness.store.saveAccount(seedAccount())
    const original = await harness.store.getBrowserProfile("acc-1")
    if (!original) throw new Error("原配置不存在")
    await harness.store.saveBrowserProfile({ ...original, id: "late-reference", name: "晚到改绑" })
    const write = harness.store.updateAccount.bind(harness.store)
    let intercepted = false
    harness.store.updateAccount = async (...args) => {
      if (!intercepted) {
        intercepted = true
        await write("acc-1", { browserProfileId: "late-reference" })
      }
      return write(...args)
    }
    await expect(
      harness.service.authorize({
        accountId: "acc-1",
        displayName: "账号",
        browserProfileId: "acc-1",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })
    expect(harness.exchangeRedirectUris).toHaveLength(1)
    expect(await harness.store.getAccount("acc-1")).toMatchObject({
      browserProfileId: "late-reference",
      credential: { accessToken: "old-access" },
    })
  } finally {
    await harness.service.dispose()
    await harness.cleanup()
  }
})

it("内容相同的配置改绑也使旧授权报告失效，不交换或覆盖凭据", async () => {
  const code = deferred<string>()
  let complete = false
  const harness = await createHarness({
    profile: {
      accountUuid: "old-account",
      email: "old@example.com",
      organizationUuid: "org",
      subscriptionType: "max",
      rateLimitTier: null,
    },
    callback: {
      redirectUri: "http://localhost:1234/callback",
      isComplete: () => complete,
      waitForCode: () => code.promise,
      cancel: () => undefined,
      close: async () => undefined,
    },
  })
  try {
    await harness.store.saveAccount(seedAccount())
    const original = await harness.store.getBrowserProfile("acc-1")
    if (!original) throw new Error("原配置不存在")
    await harness.store.saveBrowserProfile({
      ...original,
      id: "same-environment",
      name: "另一份同环境配置",
    })
    const operation = harness.service.authorize({
      accountId: "acc-1",
      displayName: "账号",
      browserProfileId: "acc-1",
    })
    await harness.launched.promise
    await harness.store.updateAccount("acc-1", { browserProfileId: "same-environment" })
    complete = true
    code.resolve("synthetic-code")
    await expect(operation).rejects.toMatchObject({ code: "ENVIRONMENT_CHECK_FAILED" })
    expect(harness.exchangeRedirectUris).toEqual([])
    expect(await harness.store.getAccount("acc-1")).toMatchObject({
      browserProfileId: "same-environment",
      credential: { accessToken: "old-access" },
    })
  } finally {
    complete = true
    code.resolve("synthetic-code")
    await harness.service.dispose()
    await harness.cleanup()
  }
})

it("账号改绑提交期间不能启动旧配置授权，提交完成后才解除屏障", async () => {
  const harness = await createHarness({
    profile: {
      accountUuid: "old-account",
      email: "old@example.com",
      organizationUuid: "org",
      subscriptionType: "max",
      rateLimitTier: null,
    },
  })
  const entered = deferred<void>(),
    gate = deferred<void>()
  await harness.store.saveAccount(seedAccount())
  const original = await harness.store.getBrowserProfile("acc-1")
  if (!original) throw new Error("原配置不存在")
  await harness.store.saveBrowserProfile({ ...original, id: "target-config", name: "目标配置" })
  const write = harness.store.updateAccount.bind(harness.store)
  let calls = 0
  harness.store.updateAccount = async (...args) => {
    if (++calls === 1) {
      entered.resolve()
      await gate.promise
    }
    return write(...args)
  }
  const rebinding = harness.service.update({
    accountId: "acc-1",
    browserProfileId: "target-config",
  })
  try {
    await entered.promise
    await expect(
      harness.service.authorize({
        accountId: "acc-1",
        displayName: "账号",
        browserProfileId: "acc-1",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })
    expect(harness.launchInputs).toEqual([])
    gate.resolve()
    await rebinding
    expect((await harness.store.getAccount("acc-1"))?.browserProfileId).toBe("target-config")
  } finally {
    gate.resolve()
    await rebinding.catch(() => undefined)
    await harness.service.dispose()
    await harness.cleanup()
  }
})

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
