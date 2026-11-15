// 验证市场源公开操作、原子缓存及准备安装时锁定的来源状态。
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { MembershipState } from "@pigclaude/contracts/membership"
import { expect, it, vi } from "vitest"
import type { PluginMarketplaceSourceInput } from "../../plugin-marketplace-contract"
import type { PluginMarketplaceCatalog } from "./plugin-marketplace-catalog"
import { PluginMarketplaceSources } from "./plugin-marketplace-sources"

const remote = { kind: "github", repo: "fixture/market", commit: "a".repeat(40) } as const
const nextRemote = { ...remote, commit: "b".repeat(40) }
const https = {
  kind: "https",
  url: "https://fixture.invalid/market.zip",
  sha256: "c".repeat(64),
} as const
const nextHttps = { ...https, sha256: "d".repeat(64) }
const local = { kind: "directory", path: join(tmpdir(), "fictional-marketplace") } as const

function catalog(version: string): PluginMarketplaceCatalog {
  return {
    name: "夹具市场",
    entries: [
      {
        info: {
          id: "fixture",
          name: "合成插件",
          type: "capability",
          description: null,
          version,
          author: null,
          permissions: [],
          domains: [],
        },
        source: { kind: "relative", path: "pack" },
        expectedSha256: null,
      },
    ],
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pigclaude-market-sources-"))
  let member: MembershipState = "active"
  let developer = true
  const normalize = (input: unknown): PluginMarketplaceSourceInput => {
    const selected = [remote, nextRemote, https, nextHttps, local].find(
      (source) => JSON.stringify(source) === JSON.stringify(input),
    )
    if (!selected) throw new Error("PLUGIN_MARKETPLACE_SOURCE_INVALID")
    return selected
  }
  const load = vi.fn(async () => catalog("1.0.0"))
  const cacheDirectory = join(root, "cache")
  const options = {
    path: join(cacheDirectory, "sources.json"),
    membership: () => member,
    developerMode: () => developer,
    normalize,
    load,
  }
  const sources = new PluginMarketplaceSources(options)
  return {
    sources,
    cacheDirectory,
    reopen: () => new PluginMarketplaceSources(options),
    load,
    setMembership: (state: MembershipState) => {
      member = state
      sources.membershipChanged(state)
    },
    setDeveloper: (enabled: boolean) => {
      developer = enabled
    },
    close: () => rm(root, { recursive: true, force: true }),
  }
}

it("重开用缓存，刷新失败保留已验证的条目和成功时间", async () => {
  const f = await fixture()
  try {
    const changed = vi.fn()
    const unsubscribe = f.sources.subscribe(changed)
    await f.sources.add(remote)
    expect(changed).toHaveBeenCalledOnce()
    unsubscribe()
    const cached = f.reopen()
    const initial = await cached.list()
    const source = initial.sources[0]
    if (!source) throw new Error("没有保存市场源")
    expect(initial.entries).toEqual([{ sourceId: source.id, entry: catalog("1.0.0").entries[0] }])
    expect(f.load).toHaveBeenCalledTimes(1)

    f.load.mockRejectedValueOnce(new Error("本机合成加载细节"))
    await expect(cached.refresh(source.id)).rejects.toThrow()
    await expect(f.reopen().list()).resolves.toEqual({
      ...initial,
      sources: [{ ...source, error: "PLUGIN_MARKETPLACE_REFRESH_FAILED" }],
    })
  } finally {
    await f.close()
  }
})

it("源的目录、启停或存在性变化使旧确认失效，等价刷新仍可提交", async () => {
  const f = await fixture()
  try {
    await f.sources.add(remote)
    const id = await firstId(f.sources)
    const first = await f.sources.resolve(id, "fixture")
    first.entry.info.permissions.push("synthetic-mutation")
    expect((await f.sources.resolve(id, "fixture")).entry.info.permissions).toEqual([])
    await f.sources.refresh(id)
    expect(first.assertCurrent).not.toThrow()

    f.load.mockResolvedValueOnce(catalog("2.0.0"))
    await f.sources.refresh(id)
    expect(first.assertCurrent).toThrow("PLUGIN_MARKETPLACE_SOURCE_CHANGED")
    const second = await f.sources.resolve(id, "fixture")
    expect(second.entry.info.version).toBe("2.0.0")
    await f.sources.setEnabled(id, false)
    await expect(f.sources.list()).resolves.toMatchObject({ entries: [] })
    await expect(f.sources.resolve(id, "fixture")).rejects.toThrow(
      "PLUGIN_MARKETPLACE_SOURCE_DISABLED",
    )
    await f.sources.setEnabled(id, true)
    expect(second.assertCurrent).toThrow("PLUGIN_MARKETPLACE_SOURCE_CHANGED")

    const third = await f.sources.resolve(id, "fixture")
    await f.sources.remove(id)
    expect(third.assertCurrent).toThrow("PLUGIN_MARKETPLACE_SOURCE_CHANGED")
    await expect(f.reopen().list()).resolves.toMatchObject({ sources: [], entries: [] })
  } finally {
    await f.close()
  }
})

it("会员退出后恢复，旧下载和待提交确认仍然失效", async () => {
  const f = await fixture()
  try {
    await f.sources.add(remote)
    const id = await firstId(f.sources)
    const prepared = await f.sources.resolve(id, "fixture")
    const refresh = pendingRefresh(f)
    const update = expect(f.sources.refresh(id)).rejects.toThrow(
      "PLUGIN_MARKETPLACE_SOURCE_CHANGED",
    )
    await refresh.started

    f.setMembership("network_grace")
    expect(prepared.assertCurrent).toThrow("MEMBERSHIP_REQUIRED")
    f.setMembership("active")
    expect(prepared.assertCurrent).toThrow("PLUGIN_MARKETPLACE_SOURCE_CHANGED")
    refresh.complete(catalog("2.0.0"))
    await update

    const current = await f.sources.resolve(id, "fixture")
    expect(current.entry.info.version).toBe("1.0.0")
    expect(current.assertCurrent).not.toThrow()
    await expect(f.reopen().list()).resolves.toEqual(await f.sources.list())
  } finally {
    await f.close()
  }
})

it("删除不会等待正在下载的刷新，晚到的内容也不会重新添加来源", async () => {
  const f = await fixture()
  try {
    await f.sources.add(remote)
    const id = await firstId(f.sources)
    const refresh = pendingRefresh(f)
    const update = expect(f.sources.refresh(id)).rejects.toThrow(
      "PLUGIN_MARKETPLACE_SOURCE_NOT_FOUND",
    )
    await refresh.started
    await f.sources.remove(id)
    refresh.complete(catalog("2.0.0"))
    await update
    await expect(f.sources.list()).resolves.toMatchObject({ sources: [], entries: [] })
  } finally {
    await f.close()
  }
})

it("程序离开开发模式后还可删目录源，既有目录确认立即不能提交", async () => {
  const f = await fixture()
  try {
    await f.sources.add(local)
    const id = await firstId(f.sources)
    const prepared = await f.sources.resolve(id, "fixture")
    f.setDeveloper(false)
    expect(prepared.assertCurrent).toThrow("PLUGIN_DEVELOPER_MODE_REQUIRED")
    await expect(f.sources.list()).resolves.toMatchObject({ developerMode: false, entries: [] })
    await expect(f.sources.refresh(id)).rejects.toThrow("PLUGIN_DEVELOPER_MODE_REQUIRED")
    await f.sources.remove(id)
    await expect(f.reopen().list()).resolves.toMatchObject({ sources: [] })
  } finally {
    await f.close()
  }
})

async function firstId(sources: PluginMarketplaceSources): Promise<string> {
  const source = (await sources.list()).sources[0]
  if (!source) throw new Error("缺少合成源")
  return source.id
}

function pendingRefresh(f: Awaited<ReturnType<typeof fixture>>) {
  let start = () => {}
  const started = new Promise<void>((resolve) => {
    start = resolve
  })
  let complete: (value: PluginMarketplaceCatalog) => void = () => {}
  const pending = new Promise<PluginMarketplaceCatalog>((resolve) => {
    complete = resolve
  })
  f.load.mockImplementationOnce(() => {
    start()
    return pending
  })
  return { started, complete }
}

it("原子保存失败时保留旧内存和磁盘快照，后续可以重试", async () => {
  const f = await fixture()
  try {
    await f.sources.add(remote)
    const id = await firstId(f.sources)
    const original = await f.sources.list()
    const prepared = await f.sources.resolve(id, "fixture")
    const backup = f.cacheDirectory + "-fixture-backup"
    await rename(f.cacheDirectory, backup)
    try {
      await writeFile(f.cacheDirectory, "合成的写盘失败")
      f.load.mockResolvedValueOnce(catalog("2.0.0"))
      await expect(f.sources.refresh(id)).rejects.toThrow()
      await expect(f.sources.list()).resolves.toEqual(original)
      expect(prepared.assertCurrent).not.toThrow()
    } finally {
      await rm(f.cacheDirectory, { force: true })
      await rename(backup, f.cacheDirectory)
    }
    await expect(f.reopen().list()).resolves.toEqual(original)

    f.load.mockResolvedValueOnce(catalog("2.0.0"))
    await f.sources.refresh(id)
    expect(prepared.assertCurrent).toThrow("PLUGIN_MARKETPLACE_SOURCE_CHANGED")
    expect((await f.reopen().resolve(id, "fixture")).entry.info.version).toBe("2.0.0")
  } finally {
    await f.close()
  }
})

it.each([
  [remote, nextRemote, remote.commit, nextRemote.commit],
  [https, nextHttps, https.sha256, nextHttps.sha256],
] as const)("远程源手动换 pin，失败守旧且成功时撤回旧确认", async (first, next, oldPin, newPin) => {
  const f = await fixture()
  try {
    await f.sources.add(first)
    const id = await firstId(f.sources)
    const prepared = await f.sources.resolve(id, "fixture")
    const initial = await f.sources.list()
    expect(initial.sources).toMatchObject([{ id, pin: oldPin, enabled: true }])

    f.load.mockRejectedValueOnce(new Error("合成远程源读取失败"))
    await expect(f.sources.refresh(id, newPin)).rejects.toThrow()
    await expect(f.sources.list()).resolves.toMatchObject({
      sources: [{ id, pin: oldPin, enabled: true }],
      entries: initial.entries,
    })
    expect(prepared.assertCurrent).not.toThrow()

    // 两次发布的解析目录完全相同，单独换 pin 也使旧的安装授权过期。
    await f.sources.refresh(id, newPin)
    expect(f.load).toHaveBeenLastCalledWith(next)
    expect(prepared.assertCurrent).toThrow("PLUGIN_MARKETPLACE_SOURCE_CHANGED")
    await expect(f.reopen().list()).resolves.toMatchObject({
      sources: [{ id, pin: newPin, enabled: true, error: null }],
      entries: initial.entries,
    })
    const current = await f.sources.resolve(id, "fixture")
    expect(current.input).toEqual(next)
    expect(current.assertCurrent).not.toThrow()
  } finally {
    await f.close()
  }
})

it("停用源换 pin 保持隐藏，本地目录默认没有 pin", async () => {
  const f = await fixture()
  try {
    await f.sources.add(local)
    const localId = await firstId(f.sources)
    await expect(f.sources.list()).resolves.toMatchObject({ sources: [{ id: localId, pin: null }] })
    await expect(f.sources.refresh(localId, "a".repeat(40))).rejects.toThrow(
      "PLUGIN_MARKETPLACE_SOURCE_INVALID",
    )
    await f.sources.remove(localId)

    await f.sources.add(remote)
    const id = await firstId(f.sources)
    await f.sources.setEnabled(id, false)
    await f.sources.refresh(id, nextRemote.commit)
    await expect(f.reopen().list()).resolves.toMatchObject({
      sources: [{ id, pin: nextRemote.commit, enabled: false }],
      entries: [],
    })
  } finally {
    await f.close()
  }
})
