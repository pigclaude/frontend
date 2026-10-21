// 本机账号库测试。重新打开后仍保留凭据和指纹；旧记录迁移；两次保存交错时两条记录都还在。

import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { LocalStore, type AccountRecord, type ClaudeCredential, type IpProxy } from "./store.ts"

const fingerprint = {
  seed: "123456",
  brand: "Chrome",
  platform: "macos",
  lang: "en-US",
  timezone: "America/Los_Angeles",
  canvasNoise: true,
  clientRectsNoise: true,
}

const credential: ClaudeCredential = {
  schemaVersion: 1,
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresAt: 1_760_000_000_000,
  scopes: ["user:inference"],
  accountUuid: "account-uuid",
  email: "user@example.com",
  organizationUuid: "organization-uuid",
  subscriptionType: "max",
  rateLimitTier: null,
}

describe("LocalStore", () => {
  it("keeps the credential and user-set fingerprint when the account is loaded again", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-"))
    const store = new LocalStore(dir)
    await store.saveProxy(proxy("p1"))
    await store.saveAccount(account("acc-1"))
    const again = new LocalStore(dir)
    expect(await again.getAccount("acc-1")).toMatchObject({
      credential,
      fingerprint,
    })
    const names = await readdir(dir)
    expect(names.sort()).toEqual(["accounts.json", "proxies.json"])
  })

  it("keeps both records when two saves of the same file overlap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-"))
    const store = new LocalStore(dir)
    const firstAccount = store.saveAccount(account("acc-1"))
    const secondAccount = store.saveAccount(account("acc-2"))
    await Promise.all([firstAccount, secondAccount])
    const accounts = await store.listAccounts()
    expect(accounts.map((item) => item.id).sort()).toEqual(["acc-1", "acc-2"])

    const firstProxy = store.saveProxy(proxy("p1"))
    const secondProxy = store.saveProxy(proxy("p2"))
    await Promise.all([firstProxy, secondProxy])
    expect((await store.listProxies()).map((item) => item.id).sort()).toEqual(["p1", "p2"])
  })

  it("migrates legacy accounts without reusing the old string credential", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-"))
    await writeFile(
      join(dir, "accounts.json"),
      JSON.stringify([
        {
          id: "legacy",
          enabled: true,
          credential: "old-string-credential",
          proxyId: "p1",
          fingerprint,
          exhaustedUntil: null,
        },
      ]),
      "utf8",
    )
    const store = new LocalStore(dir)
    expect(await store.getAccount("legacy")).toEqual({
      schemaVersion: 3,
      id: "legacy",
      displayName: "legacy",
      enabled: true,
      credential: null,
      needsReauth: true,
      proxyId: "p1",
      fingerprint,
      browserProfileDir: "",
      exhaustedUntil: null,
      createdAt: "",
      updatedAt: "",
    })
  })

  it("migrates v2 accounts and drops the AntBrowser fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-"))
    await writeFile(
      join(dir, "accounts.json"),
      JSON.stringify([
        {
          schemaVersion: 2,
          id: "acc-2",
          displayName: "旧账号",
          enabled: true,
          credential,
          needsReauth: false,
          proxyId: "p1",
          fingerprint,
          antProfileId: "ant-1",
          antLaunchCode: "PIGCLAUDE_ACC-2",
          exhaustedUntil: null,
          createdAt: "2026-10-21T00:00:00.000Z",
          updatedAt: "2026-10-21T00:00:00.000Z",
        },
      ]),
      "utf8",
    )
    const store = new LocalStore(dir)
    expect(await store.getAccount("acc-2")).toMatchObject({
      schemaVersion: 3,
      credential,
      browserProfileDir: "",
    })
  })

  it("migrates legacy proxies with a name and no test result", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-"))
    await writeFile(
      join(dir, "proxies.json"),
      JSON.stringify([{ id: "p1", url: "http://127.0.0.1:18080" }]),
      "utf8",
    )
    const store = new LocalStore(dir)
    expect(await store.getProxy("p1")).toEqual({
      schemaVersion: 1,
      id: "p1",
      name: "p1",
      url: "http://127.0.0.1:18080",
      lastTest: null,
    })
  })

  it("writes account files with owner-only permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-"))
    const store = new LocalStore(dir)
    await store.saveAccount(account("acc-1"))
    const mode = (await stat(join(dir, "accounts.json"))).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it("removes only the requested account and proxy", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-"))
    const store = new LocalStore(dir)
    await store.saveProxy(proxy("p1"))
    await store.saveProxy(proxy("p2"))
    await store.saveAccount(account("acc-1"))
    await store.saveAccount(account("acc-2"))
    await store.removeAccount("acc-1")
    await store.removeProxy("p1")
    expect((await store.listAccounts()).map((item) => item.id)).toEqual(["acc-2"])
    expect((await store.listProxies()).map((item) => item.id)).toEqual(["p2"])
  })

  it("keeps the raw file readable as a plain JSON list", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-"))
    const store = new LocalStore(dir)
    await store.saveAccount(account("acc-1"))
    const parsed: unknown = JSON.parse(await readFile(join(dir, "accounts.json"), "utf8"))
    expect(Array.isArray(parsed)).toBe(true)
    expect(JSON.stringify(parsed)).toContain("access-token")
  })
})

function account(id: string): AccountRecord {
  return {
    schemaVersion: 3,
    id,
    displayName: id,
    enabled: true,
    credential,
    needsReauth: false,
    proxyId: "p1",
    fingerprint,
    browserProfileDir: `/tmp/browser-profiles/${id}`,
    exhaustedUntil: null,
    createdAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
  }
}

function proxy(id: string): IpProxy {
  return {
    schemaVersion: 1,
    id,
    name: id,
    url: `http://127.0.0.1:${id === "p1" ? "1" : "2"}`,
    lastTest: null,
  }
}
