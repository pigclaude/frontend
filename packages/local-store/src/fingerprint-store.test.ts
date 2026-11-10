// 指纹归一化与本机账号库容错测试。旧记录补默认值、损坏记录不拖垮整库、扩展字段完整往返。

import { mkdtemp, writeFile } from "node:fs/promises"
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

const defaultFingerprint = {
  seed: "",
  brand: "Chrome",
  platform: "macos",
  lang: "",
  timezone: "",
  canvasNoise: "",
  clientRectsNoise: "",
  ...emptyExtras,
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

describe("LocalStore fingerprint normalization", () => {
  it("normalizes old boolean noise and fills new defaults for seven-field records", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fingerprint-"))
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
    const dir = await mkdtemp(join(tmpdir(), "fingerprint-"))
    const record = { ...account("acc-full"), fingerprint: extendedFingerprint }
    await new LocalStore(dir).saveAccount(record)
    expect(await new LocalStore(dir).getAccount("acc-full")).toEqual({
      ...record,
      schemaVersion: 4,
      browserProfileId: "acc-full",
      browserProfileRevision: 1,
      browserProfileDir: "",
    })
  })

  it("filters invalid optional fingerprint values without failing the file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fingerprint-"))
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
    const dir = await mkdtemp(join(tmpdir(), "fingerprint-"))
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
    const dir = await mkdtemp(join(tmpdir(), "fingerprint-"))
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
      schemaVersion: 4,
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

  it("falls back to the default fingerprint when a stored fingerprint is damaged", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fingerprint-"))
    await writeFile(
      join(dir, "accounts.json"),
      JSON.stringify([
        { ...account("null-fingerprint"), fingerprint: null },
        { ...account("wrong-brand"), fingerprint: { ...fingerprint, brand: 42 } },
        {
          ...account("missing-timezone"),
          fingerprint: {
            seed: fingerprint.seed,
            brand: fingerprint.brand,
            platform: fingerprint.platform,
            lang: fingerprint.lang,
            canvasNoise: fingerprint.canvasNoise,
            clientRectsNoise: fingerprint.clientRectsNoise,
          },
        },
        account("acc-good"),
      ]),
      "utf8",
    )
    const store = new LocalStore(dir, { systemLocale: () => "en-US", systemTimezone: () => "UTC" })
    const accounts = await store.listAccounts()
    expect(accounts.map((item) => item.id)).toEqual([
      "null-fingerprint",
      "wrong-brand",
      "missing-timezone",
      "acc-good",
    ])
    for (const id of ["null-fingerprint", "wrong-brand", "missing-timezone"]) {
      expect(accounts.find((item) => item.id === id)?.fingerprint).toEqual({
        ...defaultFingerprint,
        lang: "en-US",
        timezone: "UTC",
      })
    }
    expect(accounts.find((item) => item.id === "acc-good")?.fingerprint).toEqual({
      ...fingerprint,
      ...emptyExtras,
    })
  })

  it("skips structurally broken account records and keeps the library readable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fingerprint-"))
    await writeFile(
      join(dir, "accounts.json"),
      JSON.stringify([{ id: 42 }, null, account("acc-good")]),
      "utf8",
    )
    const store = new LocalStore(dir)
    expect((await store.listAccounts()).map((item) => item.id)).toEqual(["acc-good"])
    expect(await store.getAccount("acc-good")).not.toBeNull()

    await store.saveAccount(account("acc-new"))
    expect((await new LocalStore(dir).listAccounts()).map((item) => item.id)).toEqual([
      "acc-good",
      "acc-new",
    ])
  })

  it("skips structurally broken proxy records and keeps the rest readable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fingerprint-"))
    await writeFile(
      join(dir, "proxies.json"),
      JSON.stringify([{ id: 42, url: 5 }, proxy("p1")]),
      "utf8",
    )
    const store = new LocalStore(dir)
    expect((await store.listProxies()).map((item) => item.id)).toEqual(["p1"])
    expect(await store.getProxy("p1")).not.toBeNull()
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

function proxy(id: string): IpProxy {
  return {
    schemaVersion: 1,
    id,
    name: id,
    url: `http://127.0.0.1:${id === "p1" ? "1" : "2"}`,
    lastTest: null,
  }
}
