// 从公开授权入口验证账号只引用独立实例，并实际使用实例确定的浏览器与 CLI 启动环境。

import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { LocalStore } from "@pigclaude/local-store"
import { createHarness, fingerprint, seedAccount } from "./account-service-test-fixtures"

it("多个账号可引用同一配置，授权浏览器数据仍按各账号隔离", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-profile-shared-"))
  const store = new LocalStore(directory)
  await store.saveBrowserProfile({
    schemaVersion: 1,
    id: "shared",
    name: "共享环境配置",
    proxyId: "p1",
    fingerprint,
    revision: 1,
    createdAt: "",
    updatedAt: "",
  })
  const first = await createHarness({ store, id: () => "account-a" })
  const second = await createHarness({ store, id: () => "account-b" })
  try {
    const [a, b] = await Promise.all([
      first.service.authorize({ displayName: "甲", browserProfileId: "shared" }),
      second.service.authorize({ displayName: "乙", browserProfileId: "shared" }),
    ])
    expect(a.browserProfileId).toBe("shared")
    expect(b.browserProfileId).toBe("shared")
    expect(first.launchInputs[0]).toMatchObject({
      accountId: "account-a",
      browserProfileId: "shared",
      browserDataId: "account-a",
    })
    expect(second.launchInputs[0]).toMatchObject({
      accountId: "account-b",
      browserProfileId: "shared",
      browserDataId: "account-b",
    })
  } finally {
    await Promise.all([first.service.dispose(), second.service.dispose()])
    await Promise.all([first.cleanup(), second.cleanup()])
    await rm(directory, { recursive: true, force: true })
  }
})

it("旧账号迁移为独立实例，重新授权继续使用原环境", async () => {
  const harness = await createHarness()
  try {
    const existingRecord = seedAccount()
    if (existingRecord.credential) existingRecord.credential.accountUuid = "account-1"
    await harness.store.saveAccount(existingRecord)
    const [existing] = await harness.service.list()
    expect(existing?.browserProfileId).toBe("acc-1")
    const result = await harness.service.authorize({
      accountId: "acc-1",
      displayName: "迁移后账号",
      browserProfileId: "acc-1",
    })
    expect(result).toMatchObject({ browserProfileId: "acc-1", fingerprint, proxyId: "p1" })
    expect(harness.launchInputs[0]).toMatchObject({ browserDataId: "acc-1", fingerprint })
  } finally {
    await harness.service.dispose()
    await harness.cleanup()
  }
})

it("添加账号选择已有实例，授权采用该实例的指纹和代理", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-profile-account-"))
  await writeFile(
    join(directory, "browser-profiles.json"),
    JSON.stringify([
      {
        schemaVersion: 1,
        id: "profile-japan",
        name: "日本工作环境",
        browserDataId: "profile-japan",
        proxyId: "p1",
        fingerprint: { ...fingerprint, lang: "ja-JP", timezone: "Asia/Tokyo" },
        revision: 1,
        createdAt: "2026-11-10T00:00:00.000Z",
        updatedAt: "2026-11-10T00:00:00.000Z",
      },
    ]),
  )
  const harness = await createHarness({ store: new LocalStore(directory) })
  try {
    const result = await harness.service.authorize({
      displayName: "工作账号",
      browserProfileId: "profile-japan",
    })
    expect(result).toMatchObject({
      browserProfileId: "profile-japan",
      proxyId: "p1",
      fingerprint: { lang: "ja-JP", timezone: "Asia/Tokyo" },
    })
    expect(harness.launchInputs[0]).toMatchObject({
      browserProfileId: "profile-japan",
      fingerprint: { lang: "ja-JP", timezone: "Asia/Tokyo" },
    })
    expect(harness.exchangeRedirectUris).toHaveLength(1)
  } finally {
    await harness.service.dispose()
    await harness.cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})
