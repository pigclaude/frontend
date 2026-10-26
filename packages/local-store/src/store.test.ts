// 本机账号库测试。重新打开后仍保留凭据和指纹；旧记录迁移；两次保存交错时两条记录都还在。

import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  LocalStore,
  normalizeFingerprint,
  type AccountRecord,
  type ClaudeCredential,
  type FingerprintConfig,
  type IpProxy,
} from "./store.ts"

const fingerprint: FingerprintConfig = {
  seed: "123456",
  brand: "Chrome",
  platform: "macos",
  lang: "en-US",
  timezone: "America/Los_Angeles",
  canvasNoise: "1",
  clientRectsNoise: "1",
}

const extendedFingerprint: FingerprintConfig = {
  ...fingerprint,
  brandVersion: "144.0.7559.0",
  platformVersion: "15.0.0",
  acceptLang: "en-US,en",
  resolution: "1920,1080",
  customResolution: "2560,1440",
  hardwareConcurrency: "8",
  webrtcPolicy: "disable_non_proxied_udp",
  disableSpoofing: ["font", "audio", "canvas"],
  colorDepth: "24",
  deviceMemory: "8",
  touchPoints: "5",
  doNotTrack: "1",
  mediaDevices: "1",
  audioNoise: "1",
  fontList: "Arial",
  webglVendor: "Google Inc.",
  webglRenderer: "ANGLE",
  unknownArgs: ["--disable-gpu", "--js-flags=--max-old-space-size=4096"],
}

const emptyExtras = {
  brandVersion: "",
  platformVersion: "",
  acceptLang: "",
  resolution: "",
  customResolution: "",
  hardwareConcurrency: "",
  webrtcPolicy: "" as const,
  disableSpoofing: [] as [],
  colorDepth: "",
  deviceMemory: "",
  touchPoints: "",
  doNotTrack: "",
  mediaDevices: "",
  audioNoise: "",
  fontList: "",
  webglVendor: "",
  webglRenderer: "",
  unknownArgs: [] as string[],
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
      fingerprint: { ...fingerprint, ...emptyExtras },
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
      proxyId: "p1",
      browserProfileDir: "",
    })
  })

  it("reads v3 accounts with a missing or null proxy id as direct", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-"))
    await writeFile(
      join(dir, "accounts.json"),
      JSON.stringify([
        storedAccount("missing"),
        storedAccount("direct", null),
        storedAccount("empty", ""),
        storedAccount("bound", "p1"),
      ]),
      "utf8",
    )
    const store = new LocalStore(dir)
    expect((await store.getAccount("missing"))?.proxyId).toBeNull()
    expect((await store.getAccount("direct"))?.proxyId).toBeNull()
    expect((await store.getAccount("empty"))?.proxyId).toBeNull()
    expect((await store.getAccount("bound"))?.proxyId).toBe("p1")
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

  it("merges concurrent account updates without losing either field", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-"))
    const store = new LocalStore(dir)
    await store.saveAccount(account("acc-1"))

    const first = store.updateAccount("acc-1", { displayName: "新名字" })
    const second = store.updateAccount("acc-1", { enabled: false })
    await Promise.all([first, second])

    expect(await store.getAccount("acc-1")).toMatchObject({
      displayName: "新名字",
      enabled: false,
      credential,
    })
  })

  it("applies an updater against the latest record inside the write queue", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-"))
    const store = new LocalStore(dir)
    await store.saveAccount(account("acc-1"))

    const first = store.updateAccount("acc-1", (current) => ({
      ...current,
      exhaustedUntil: "2026-10-26T00:05:00.000Z",
    }))
    const second = store.updateAccount("acc-1", (current) => ({
      ...current,
      needsReauth: true,
    }))
    await Promise.all([first, second])

    expect(await store.getAccount("acc-1")).toMatchObject({
      exhaustedUntil: "2026-10-26T00:05:00.000Z",
      needsReauth: true,
    })
  })

  it("does not resurrect an account deleted before the update reaches the queue", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-"))
    const store = new LocalStore(dir)
    await store.saveAccount(account("acc-1"))

    const removal = store.removeAccount("acc-1")
    const update = store.updateAccount("acc-1", { enabled: false })
    await Promise.all([removal, update])

    expect(await update).toBeNull()
    expect(await store.getAccount("acc-1")).toBeNull()
  })

  it("keeps the raw file readable as a plain JSON list", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-"))
    const store = new LocalStore(dir)
    await store.saveAccount(account("acc-1"))
    const parsed: unknown = JSON.parse(await readFile(join(dir, "accounts.json"), "utf8"))
    expect(Array.isArray(parsed)).toBe(true)
    expect(JSON.stringify(parsed)).toContain("access-token")
  })

  it("writes a null proxy id back so a reopened store still reads direct", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-"))
    const store = new LocalStore(dir)
    await store.saveAccount({ ...account("acc-1"), proxyId: null })
    const raw = await readFile(join(dir, "accounts.json"), "utf8")
    expect(raw).toContain('"proxyId":null')
    const again = new LocalStore(dir)
    expect((await again.getAccount("acc-1"))?.proxyId).toBeNull()
  })

  it("normalizes old boolean noise and fills new defaults for seven-field records", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-"))
    await writeFile(
      join(dir, "accounts.json"),
      JSON.stringify([
        {
          ...account("acc-old"),
          fingerprint: {
            ...fingerprint,
            canvasNoise: true,
            clientRectsNoise: false,
            unknownField: "drop-me",
          },
        },
      ]),
      "utf8",
    )
    const accountRecord = await new LocalStore(dir).getAccount("acc-old")
    expect(accountRecord?.fingerprint).toEqual({
      ...fingerprint,
      canvasNoise: "1",
      clientRectsNoise: "0",
      ...emptyExtras,
    })
  })

  it("round-trips every extended fingerprint field after reopening", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-"))
    const record = { ...account("acc-full"), fingerprint: extendedFingerprint }
    await new LocalStore(dir).saveAccount(record)
    expect(await new LocalStore(dir).getAccount("acc-full")).toEqual(record)
  })

  it("filters invalid optional fingerprint values without failing the file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-"))
    await writeFile(
      join(dir, "accounts.json"),
      JSON.stringify([
        {
          ...account("acc-junk"),
          fingerprint: {
            ...fingerprint,
            brandVersion: 144,
            platformVersion: null,
            hardwareConcurrency: ["8"],
            webrtcPolicy: "bogus",
            disableSpoofing: ["font", "webgl", "font", "audio", 3],
            unknownArgs: ["--foo", 2, null, "--bar"],
            extraKey: "drop-me",
          },
        },
      ]),
      "utf8",
    )
    const accountRecord = await new LocalStore(dir).getAccount("acc-junk")
    expect(accountRecord?.fingerprint).toEqual({
      ...fingerprint,
      ...emptyExtras,
      disableSpoofing: ["font", "audio"],
      unknownArgs: ["--foo", "--bar"],
    })
    expect(accountRecord?.fingerprint).not.toHaveProperty("extraKey")
  })

  it("writes a normalized seven-field record back so it survives reopening", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-"))
    await writeFile(
      join(dir, "accounts.json"),
      JSON.stringify([
        {
          ...account("acc-old"),
          fingerprint: { ...fingerprint, canvasNoise: true, clientRectsNoise: true },
        },
      ]),
      "utf8",
    )
    const store = new LocalStore(dir)
    const loaded = await store.getAccount("acc-old")
    expect(loaded).not.toBeNull()
    if (loaded === null) return
    await store.saveAccount(loaded)
    expect(await new LocalStore(dir).getAccount("acc-old")).toEqual(loaded)
  })

  it("reads legacy v2 accounts through the same fingerprint normalization", async () => {
    const dir = await mkdtemp(join(tmpdir(), "store-"))
    await writeFile(
      join(dir, "accounts.json"),
      JSON.stringify([
        {
          schemaVersion: 2,
          id: "acc-v2",
          displayName: "旧账号",
          enabled: true,
          credential,
          needsReauth: false,
          proxyId: "p1",
          fingerprint: { ...fingerprint, canvasNoise: false, clientRectsNoise: true },
          antProfileId: "ant-1",
          antLaunchCode: "PIGCLAUDE_ACC-V2",
          exhaustedUntil: null,
          createdAt: "2026-10-21T00:00:00.000Z",
          updatedAt: "2026-10-21T00:00:00.000Z",
        },
      ]),
      "utf8",
    )
    const accountRecord = await new LocalStore(dir).getAccount("acc-v2")
    expect(accountRecord).toMatchObject({
      schemaVersion: 3,
      credential,
      proxyId: "p1",
      browserProfileDir: "",
      fingerprint: {
        ...fingerprint,
        canvasNoise: "0",
        clientRectsNoise: "1",
        ...emptyExtras,
      },
    })
  })
})

describe("normalizeFingerprint", () => {
  it("uses the fallback seed when the stored seed is missing", () => {
    const withoutSeed = { ...fingerprint, seed: undefined }
    expect(normalizeFingerprint(withoutSeed, "acc-1")).toMatchObject({ seed: "acc-1" })
    expect(normalizeFingerprint({ ...withoutSeed, seed: 42 }, "acc-2")).toMatchObject({
      seed: "acc-2",
    })
  })

  it("rejects values that are not a fingerprint record", () => {
    expect(normalizeFingerprint(null)).toBeNull()
    expect(normalizeFingerprint([])).toBeNull()
    expect(normalizeFingerprint({ ...fingerprint, brand: 42 })).toBeNull()
    expect(normalizeFingerprint({ ...fingerprint, timezone: undefined })).toBeNull()
  })

  it("maps every unknown noise value to the empty tri-state", () => {
    expect(normalizeFingerprint({ ...fingerprint, canvasNoise: "yes" })?.canvasNoise).toBe("")
    expect(normalizeFingerprint({ ...fingerprint, clientRectsNoise: 1 })?.clientRectsNoise).toBe("")
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

// proxyId 缺省时生成不含该字段的 v3 记录，用来验证读取时的归一化。
function storedAccount(id: string, proxyId?: string | null): Record<string, unknown> {
  const record: Record<string, unknown> = { ...account(id) }
  delete record.proxyId
  if (proxyId !== undefined) record.proxyId = proxyId
  return record
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
