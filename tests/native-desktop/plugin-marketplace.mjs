// 用真实 Electron 和本机临时目录贯穿市场源、两种包与需确认的手动更新。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { expect } from "@playwright/test"

const capability = "native-market-counter"
const claude = "native-market-reader"
const catalogName = "native-market-fixture"

/** 通过可信预载桥检查目录可见性、安装和权限扩大会再次披露。 */
export async function verifyPluginMarketplace(page, userData) {
  const directory = await mkdtemp(join(userData, "native-market-"))
  let sourceId
  try {
    await writeMarket(directory, false)
    sourceId = await page.evaluate(
      async ({ source, name }) => {
        const market = window.pigclaude.pluginMarketplace
        const initial = await market.list()
        if (initial.thirdPartyEnabled) throw new Error("第三方市场应默认关闭")
        if (!initial.sources.some(({ kind }) => kind === "official"))
          throw new Error("第三方市场关闭时应保留官方目录")
        await market.setThirdPartyEnabled(true)
        await market.add({ kind: "directory", path: source })
        const view = await market.list()
        const id = view.sources.find((item) => item.catalogName === name)?.id
        if (!id) throw new Error("缺少刚添加的市场目录")
        return id
      },
      { source: directory, name: catalogName },
    )

    const initial = await page.evaluate(async (id) => {
      const market = window.pigclaude.pluginMarketplace
      const entries = (await market.list()).entries.filter((entry) => entry.sourceId === id)
      return entries.map(({ type, action, reviewStatus }) => ({ type, action, reviewStatus }))
    }, sourceId)
    expect(initial).toEqual(
      expect.arrayContaining([
        { type: "capability", action: "install", reviewStatus: "unreviewed" },
        { type: "claude-code", action: "install", reviewStatus: "unreviewed" },
      ]),
    )

    const stale = await page.evaluate(
      async ({ id, entry }) => {
        const market = window.pigclaude.pluginMarketplace
        const disclosure = await market.prepareInstall(id, entry)
        await market.setEnabled(id, false)
        const hidden = !(await market.list()).entries.some((item) => item.sourceId === id)
        const blocked = await window.pigclaude.capabilityPlugins
          .confirm(disclosure.confirmationId)
          .then(
            () => false,
            (error) => String(error).includes("PLUGIN_MARKETPLACE_SOURCE_CHANGED"),
          )
        await market.setEnabled(id, true)
        return { hidden, blocked }
      },
      { id: sourceId, entry: capability },
    )
    expect(stale).toEqual({ hidden: true, blocked: true })

    for (const [entry, type] of [
      [capability, "capability"],
      [claude, "claude-code"],
    ]) {
      const published = await page.evaluate(
        async ({ id, entry }) => {
          const { pluginMarketplace, capabilityPlugins } = window.pigclaude
          const disclosure = await pluginMarketplace.prepareInstall(id, entry)
          return capabilityPlugins.confirm(disclosure.confirmationId)
        },
        { id: sourceId, entry },
      )
      expect(published).toMatchObject({ type, manifest: { id: entry } })
    }

    await writeMarket(directory, true)
    const updated = await page.evaluate(
      async ({ id, entry }) => {
        const { pluginMarketplace, capabilityPlugins } = window.pigclaude
        await pluginMarketplace.refresh(id)
        const change = await pluginMarketplace.prepareUpdate(id, entry)
        if (change.kind !== "review") throw new Error("缺少新增访问范围的确认")
        const published = await capabilityPlugins.confirm(change.disclosure.confirmationId)
        return {
          version: published.manifest.version,
          permissions: change.additionalPermissions,
          domains: change.additionalDomains,
          fileHashChanged: change.fileHashChanged,
        }
      },
      { id: sourceId, entry: capability },
    )
    expect(updated).toEqual({
      version: "2.0.0",
      permissions: ["network"],
      domains: ["docs.example.org"],
      fileHashChanged: true,
    })

    const remaining = await page.evaluate(async (id) => {
      const { pluginMarketplace, capabilityPlugins } = window.pigclaude
      await pluginMarketplace.remove(id)
      return (await capabilityPlugins.list()).map(({ manifest }) => manifest.id)
    }, sourceId)
    sourceId = undefined
    expect(remaining).toEqual(expect.arrayContaining([capability, claude]))
  } finally {
    await page.evaluate(
      async ({ id, entries }) => {
        const { pluginMarketplace, capabilityPlugins } = window.pigclaude
        await pluginMarketplace.setThirdPartyEnabled(false)
        if (id) await pluginMarketplace.remove(id).catch(() => undefined)
        await Promise.all(
          entries.map((entry) => capabilityPlugins.uninstall(entry, false).catch(() => undefined)),
        )
      },
      { id: sourceId, entries: [capability, claude] },
    )
    await rm(directory, { recursive: true, force: true })
  }
}

async function writeMarket(directory, expanded) {
  const version = expanded ? "2.0.0" : "1.0.0"
  const domains = expanded ? ["docs.example.org"] : []
  const permissions = expanded ? ["storage", "network"] : ["storage"]
  const catalog = {
    name: catalogName,
    owner: { name: "Native fixture" },
    plugins: [
      {
        name: capability,
        source: "./plugins/" + capability,
        version,
        pigclaude: { kind: "capability", permissions, domains },
      },
      { name: claude, source: "./plugins/" + claude, version: "1.0.0" },
    ],
  }
  const manifest = {
    apiVersion: 1,
    id: capability,
    name: "合成市场计数",
    version,
    pigclaudeVersion: "*",
    entry: "index.mjs",
    permissions,
    networkDomains: domains,
  }
  for (const [name, value] of [
    [".claude-plugin/marketplace.json", JSON.stringify(catalog)],
    [`plugins/${capability}/pigclaude-plugin.json`, JSON.stringify(manifest)],
    [`plugins/${capability}/index.mjs`, "export default () => 1"],
    [`plugins/${claude}/commands/read.md`, "读取本机合成数据。"],
  ]) {
    const path = join(directory, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, value)
  }
}
