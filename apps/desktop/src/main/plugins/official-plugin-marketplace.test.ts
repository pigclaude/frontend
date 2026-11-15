// 通过合成目录、验签端口和临时缓存验证官方市场的发布、恢复和确认生命周期。

import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import type { MembershipState } from "@pigclaude/contracts/membership"
import {
  OfficialPluginMarketplace,
  type OfficialPluginMarketplaceOptions,
} from "./official-plugin-marketplace"
import type {
  OfficialMarketplaceRevocation,
  OfficialMarketplaceTrustState,
  OfficialPluginMarketplaceCatalog,
} from "./official-plugin-marketplace-verification"

const directories: string[] = []
const initial = Date.parse("2026-11-15T00:00:00Z")
const expiry = "2026-11-15T01:00:00Z"
const signer = "sha256:" + "c".repeat(64)
const pluginCommit = "b".repeat(40)
const item = {
  info: {
    id: "fixture",
    name: "合成插件",
    type: "claude-code" as const,
    description: "合成目录",
    version: "1.0.0",
    author: null,
    permissions: [],
    domains: [],
  },
  source: { kind: "github" as const, repo: "fixture/plugin", commit: pluginCommit },
  expectedSha256: "d".repeat(64),
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

it("只从已缓存的同一对原始字节恢复目录和信任状态，get 不连接网络", async () => {
  const f = await fixture()
  const bundle = f.offer(3)
  expect(await f.market.get()).toBeNull()
  expect(f.download).not.toHaveBeenCalled()
  const fresh = await f.market.refresh()
  expect(fresh).toMatchObject({
    commit: bundle.commit,
    refreshedAt: new Date(initial).toISOString(),
    verified: { serial: 3 },
  })
  expect(f.verify).toHaveBeenCalledExactlyOnceWith(bundle.catalog, bundle.signature, undefined)

  const restarted = new OfficialPluginMarketplace(f.options)
  f.verify.mockClear()
  const cached = await restarted.get()
  expect(cached).toEqual(fresh)
  expect(f.download).toHaveBeenCalledOnce()
  expect(f.verify).toHaveBeenCalledExactlyOnceWith(
    bundle.catalog,
    bundle.signature,
    expect.objectContaining({
      keyFloors: { [signer]: { serial: 3, digest: fresh.verified.digest } },
    }),
  )
  expect((await restarted.resolve("fixture")).input).toEqual({
    kind: "github",
    repo: "pigclaude/plugs",
    commit: bundle.commit,
  })
  cached?.verified.catalog.entries.splice(0)
  await expect(restarted.resolve("fixture")).resolves.toMatchObject({ entry: item })
})

it("拒绝刷新回退并保持已发布目录、信任上限和准备授权", async () => {
  const f = await fixture()
  f.offer(5)
  const fresh = await f.market.refresh()
  const selected = await f.market.resolve("fixture")
  const before = await readFile(f.path)
  f.offer(4)
  await expect(f.market.refresh()).rejects.toThrow("PLUGIN_MARKETPLACE_OFFICIAL_ROLLBACK")
  expect(await f.market.get()).toEqual(fresh)
  expect(await readFile(f.path)).toEqual(before)
  expect(() => selected.assertCurrent()).not.toThrow()
})

it("重启发现签名字节损坏时保留信任上限，后续下载仍不能回退", async () => {
  const f = await fixture()
  f.offer(5)
  await f.market.refresh()
  const raw = JSON.parse(await readFile(f.path, "utf8")) as Record<string, unknown>
  raw.signature = Buffer.from("Damaged fixture signature").toString("base64")
  await writeFile(f.path, JSON.stringify(raw))

  const restarted = new OfficialPluginMarketplace(f.options)
  expect(await restarted.get()).toBeNull()
  f.offer(4)
  await expect(restarted.refresh()).rejects.toThrow("PLUGIN_MARKETPLACE_OFFICIAL_ROLLBACK")
  expect(await restarted.get()).toBeNull()
  expect(await readFile(f.path, "utf8")).toBe(JSON.stringify(raw))
  f.offer(6)
  await expect(restarted.refresh()).resolves.toMatchObject({ verified: { serial: 6 } })
})

it("损坏的信任记录不能被刷新当作首次使用", async () => {
  const f = await fixture()
  const invalid = '{"schemaVersion":1,"trust":{"keyFloors":null}}'
  await writeFile(f.path, invalid)
  f.offer(1)
  await expect(f.market.get()).rejects.toThrow("PLUGIN_MARKETPLACE_OFFICIAL_TRUST_INVALID")
  await expect(f.market.refresh()).rejects.toThrow("PLUGIN_MARKETPLACE_OFFICIAL_TRUST_INVALID")
  expect(f.download).not.toHaveBeenCalled()
  expect(await readFile(f.path, "utf8")).toBe(invalid)
})

it("下载期间继续浏览旧目录，会员离开并恢复后丢弃未发布的刷新", async () => {
  const f = await fixture()
  f.offer(3)
  const cached = await f.market.refresh()
  const oldFile = await readFile(f.path)
  const next = f.offer(4)
  let finish: (value: typeof next) => void = () => undefined
  const download = new Promise<typeof next>((done) => {
    finish = done
  })
  f.download.mockReset().mockReturnValueOnce(download)
  const refresh = f.market.refresh()
  await vi.waitFor(() => expect(f.download).toHaveBeenCalledOnce())
  expect(await f.market.get()).toEqual(cached)
  f.member("expired")
  f.member("active")
  finish(next)
  await expect(refresh).rejects.toThrow("PLUGIN_MARKETPLACE_SOURCE_CHANGED")
  expect(await f.market.get()).toEqual(cached)
  expect(await readFile(f.path)).toEqual(oldFile)
})

it("同一提交的重复刷新保留确认，目录切换后旧确认不能恢复", async () => {
  const f = await fixture()
  const raw = f.offer(3)
  await f.market.refresh()
  const prepared = await f.market.resolve("fixture")
  f.download.mockResolvedValueOnce(raw)
  await f.market.refresh()
  expect(() => prepared.assertCurrent()).not.toThrow()
  f.download.mockResolvedValueOnce({ ...raw, commit: "f".repeat(40) })
  await f.market.refresh()
  expect(() => prepared.assertCurrent()).toThrow("PLUGIN_MARKETPLACE_SOURCE_CHANGED")
  f.download.mockResolvedValueOnce(raw)
  await f.market.refresh()
  expect(() => prepared.assertCurrent()).toThrow("PLUGIN_MARKETPLACE_SOURCE_CHANGED")
})

it("过期、会员变化和发布新目录均撤销相应安装确认", async () => {
  const f = await fixture()
  f.offer(3)
  await f.market.refresh()
  const selected = await f.market.resolve("fixture")
  expect(selected.entry).toEqual(item)
  f.setNow(Date.parse(expiry))
  expect(() => selected.assertCurrent()).toThrow("PLUGIN_MARKETPLACE_OFFICIAL_EXPIRED")
  await expect(f.market.resolve("fixture")).rejects.toThrow("PLUGIN_MARKETPLACE_OFFICIAL_EXPIRED")
  expect((await f.market.get())?.verified.expiresAt).toBe(expiry)

  f.setNow(initial)
  f.member("network_grace")
  expect(() => selected.assertCurrent()).toThrow("MEMBERSHIP_REQUIRED")
  f.member("active")
  expect(() => selected.assertCurrent()).toThrow("PLUGIN_MARKETPLACE_SOURCE_CHANGED")
  const next = await f.market.resolve("fixture")
  f.offer(4, [
    {
      name: "fixture",
      repo: "fixture/plugin",
      sha: pluginCommit,
      reason: "合成吊销",
      revokedAt: expiry,
    },
  ])
  await f.market.refresh()
  expect(() => next.assertCurrent()).toThrow("PLUGIN_MARKETPLACE_SOURCE_CHANGED")
  await expect(f.market.resolve("fixture")).rejects.toThrow("PLUGIN_MARKETPLACE_OFFICIAL_REVOKED")
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pigclaude-official-market-cache-"))
  directories.push(root)
  const path = join(root, "official.json")
  const bundles: Array<{
    catalog: Buffer
    signature: Buffer
    verified: OfficialPluginMarketplaceCatalog
  }> = []
  let now = initial
  let state: MembershipState = "active"
  const download = vi.fn<OfficialPluginMarketplaceOptions["download"]>()
  const verify = vi.fn<OfficialPluginMarketplaceOptions["verify"]>(
    (catalog, signature, previous) => {
      const found = bundles.find(
        (bundle) => bundle.catalog.equals(catalog) && bundle.signature.equals(signature),
      )
      if (!found) throw new Error("PLUGIN_MARKETPLACE_OFFICIAL_SIGNATURE_INVALID")
      const { verified } = found
      const known = previous?.keyFloors[signer]
      if (known && known.serial > verified.serial)
        throw new Error("PLUGIN_MARKETPLACE_OFFICIAL_ROLLBACK")
      return {
        verified,
        trust: {
          schemaVersion: 1,
          keyFloors: { [signer]: { serial: verified.serial, digest: verified.digest } },
          revokedKeys: [],
        },
      }
    },
  )
  const parseTrust = vi.fn<OfficialPluginMarketplaceOptions["parseTrust"]>((value) => {
    if (
      typeof value !== "object" ||
      value === null ||
      !("keyFloors" in value) ||
      value.keyFloors === null
    )
      throw new Error("PLUGIN_MARKETPLACE_OFFICIAL_TRUST_INVALID")
    return value as OfficialMarketplaceTrustState
  })
  const options: OfficialPluginMarketplaceOptions = {
    path,
    active: () => state === "active",
    download,
    verify,
    parseTrust,
    now: () => now,
  }
  const market = new OfficialPluginMarketplace(options)
  return {
    path,
    market,
    download,
    verify,
    options,
    setNow(value: number) {
      now = value
    },
    member(value: MembershipState) {
      state = value
      market.membershipChanged(value)
    },
    offer(serial: number, revoked: readonly OfficialMarketplaceRevocation[] = []) {
      const catalog = Buffer.from(" 合成目录 " + serial + "\r\n")
      const signature = Buffer.from(" 合成签名 " + serial + "\n")
      bundles.push({
        catalog,
        signature,
        verified: {
          catalog: { name: "pigclaude-official", entries: [item] },
          serial,
          issuedAt: "2026-11-14T23:00:00Z",
          expiresAt: expiry,
          digest: createHash("sha256").update(catalog).digest("hex"),
          signer,
          revoked,
          revokedKeys: [],
        },
      })
      const bundle = { commit: serial.toString(16).padStart(40, "0"), catalog, signature }
      download.mockResolvedValueOnce(bundle)
      return bundle
    },
  }
}
