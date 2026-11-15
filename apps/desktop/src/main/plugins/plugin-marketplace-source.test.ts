// 通过本机合成目录和归档验证目录格式、固定来源和下载字节校验。

import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { create } from "tar"
import { afterEach, expect, it, vi } from "vitest"
import type { PluginMarketplaceSourceInput } from "../../plugin-marketplace-contract"
import { pluginArchiveLimits } from "./plugin-archive-entries"
import {
  loadPluginMarketplaceCatalog,
  loadPluginMarketplaceCatalogBytes,
  loadPluginMarketplaceEntry,
  normalizePluginMarketplaceSource,
  parsePluginMarketplaceCatalog,
} from "./plugin-marketplace-source"

const directories: string[] = []
const catalogFile = ".claude-plugin/marketplace.json"
const catalogCommit = "a".repeat(40)
const pluginCommit = "b".repeat(40)

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

it("从开发目录读取 Claude Code 条目和 PigClaude 元数据，按相对目录限制包范围", async () => {
  const root = await temp()
  await file(
    root,
    catalogFile,
    JSON.stringify({
      name: "fixture-market",
      owner: { name: "Fixture" },
      plugins: [
        {
          name: "label-kit",
          source: "./plugins/label-kit",
          description: "Read a synthetic label",
          author: { name: "Fixture Author" },
        },
        {
          name: "report-kit",
          displayName: "Fixture Report",
          source: {
            source: "github",
            repo: "FixtureOwner/Report",
            sha: pluginCommit.toUpperCase(),
            ref: "fixture",
          },
          version: "1.0.0",
          pigclaude: {
            kind: "capability",
            permissions: ["network"],
            domains: ["fixture.example.test"],
            sha256: "c".repeat(64),
          },
        },
      ],
    }),
  )
  await file(root, "plugins/label-kit/skills/label/SKILL.md", "Read the fixture.")
  await file(root, "plugins/other/skills/report/SKILL.md", "Another fixture.")
  const input = normalizePluginMarketplaceSource({ kind: "directory", path: root })
  const catalog = await loadPluginMarketplaceCatalog(input)
  expect(catalog).toEqual({
    name: "fixture-market",
    entries: [
      {
        source: { kind: "relative", path: "./plugins/label-kit" },
        expectedSha256: null,
        info: {
          id: "label-kit",
          name: "label-kit",
          type: "claude-code",
          description: "Read a synthetic label",
          author: "Fixture Author",
          version: null,
          permissions: [],
          domains: [],
        },
      },
      {
        source: { kind: "github", repo: "fixtureowner/report", commit: pluginCommit },
        expectedSha256: "c".repeat(64),
        info: {
          id: "report-kit",
          name: "Fixture Report",
          type: "capability",
          description: null,
          author: null,
          version: "1.0.0",
          permissions: ["network"],
          domains: ["fixture.example.test"],
        },
      },
    ],
  })
  const entry = catalog.entries[0]
  if (!entry) throw new Error("缺少合成目录条目")
  const loaded = await loadPluginMarketplaceEntry(input, entry)
  expect(loaded.files).toEqual(
    new Map([["skills/label/SKILL.md", Buffer.from("Read the fixture.")]]),
  )
  expect(loaded).toMatchObject({
    digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    archiveSha256: null,
    repo: null,
    commit: null,
  })
})

it("固定 GitHub 提交从实际归档取目录和包，归档摘要与文件表指纹分别保留", async () => {
  const pluginTree = { "skills/label/SKILL.md": "Read the fixture." }
  const pluginBytes = await archive("report-kit-fixture", pluginTree)
  const sha256 = digest(pluginBytes)
  const catalogBytes = await archive("fixture-market-fixture", {
    [catalogFile]: JSON.stringify({
      name: "fixture-market",
      plugins: [
        {
          name: "report-kit",
          source: { source: "github", repo: "fixtureowner/report", sha: pluginCommit },
          pigclaude: { kind: "claude-code", sha256 },
        },
      ],
    }),
  })
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(reply(catalogBytes))
    .mockResolvedValueOnce(reply(pluginBytes))
  const input: PluginMarketplaceSourceInput = {
    kind: "github",
    repo: "FixtureOwner/Market",
    commit: catalogCommit,
  }
  const entry = (await loadPluginMarketplaceCatalog(input, fetcher)).entries[0]
  if (!entry) throw new Error("缺少固定提交条目")
  const loaded = await loadPluginMarketplaceEntry(input, entry, fetcher)
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
    "https://codeload.github.com/fixtureowner/market/tar.gz/" + catalogCommit,
    "https://codeload.github.com/fixtureowner/report/tar.gz/" + pluginCommit,
  ])
  expect(loaded).toMatchObject({
    archiveSha256: sha256,
    repo: "fixtureowner/report",
    commit: pluginCommit,
  })
  expect(loaded.files).toEqual(
    new Map(Object.entries(pluginTree).map(([path, text]) => [path, Buffer.from(text)])),
  )
  expect(loaded.digest).not.toBe(sha256)
})

it("HTTPS 条目校验经过 TLS 跳转的实际归档字节，并拒绝不同内容和协议降级", async () => {
  const pluginBytes = await archive("fixture", { "skills/read/SKILL.md": "Read a fixture." })
  const { entries } = parsePluginMarketplaceCatalog(
    Buffer.from(
      JSON.stringify({
        name: "fixture-market",
        plugins: [
          {
            name: "fixture",
            source: { source: "archive", url: "https://example.test/app.tgz" },
            pigclaude: { sha256: digest(pluginBytes) },
          },
        ],
      }),
    ),
  )
  const entry = entries[0]
  if (!entry) throw new Error("缺少归档条目")
  const input: PluginMarketplaceSourceInput = {
    kind: "github",
    repo: "fixture/market",
    commit: catalogCommit,
  }
  const redirect = new Response(null, {
    status: 302,
    headers: { location: "https://cdn.example.test/archive.tgz" },
  })
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(redirect)
    .mockResolvedValueOnce(reply(pluginBytes))
  await expect(loadPluginMarketplaceEntry(input, entry, fetcher)).resolves.toMatchObject({
    archiveSha256: digest(pluginBytes),
    repo: null,
    commit: null,
  })
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
    "https://example.test/app.tgz",
    "https://cdn.example.test/archive.tgz",
  ])
  expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ redirect: "manual", credentials: "omit" })
  fetcher.mockReset().mockResolvedValueOnce(reply(Buffer.from("Other fixture bytes.")))
  await expect(loadPluginMarketplaceEntry(input, entry, fetcher)).rejects.toThrow(
    "PLUGIN_ARCHIVE_SHA256_MISMATCH",
  )
  fetcher.mockReset().mockResolvedValueOnce(
    new Response(null, {
      status: 302,
      headers: { location: "http://example.test/archive.tgz" },
    }),
  )
  await expect(loadPluginMarketplaceEntry(input, entry, fetcher)).rejects.toThrow(
    "PLUGIN_MARKETPLACE_SOURCE_UNAVAILABLE",
  )
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it("目录原始字节可单独读取，根插件内容指纹与市场目录和压缩包装无关", async () => {
  const root = await temp()
  const pluginTree = { "skills/notes/SKILL.md": "Fixture notes." }
  const json =
    " \n" +
    JSON.stringify(
      {
        name: "fixture-market",
        metadata: { pigclaude: { formatVersion: 1, serial: 1 } },
        plugins: [{ name: "notes", source: "./" }],
      },
      null,
      2,
    ) +
    "\n"
  await file(root, catalogFile, json)
  await file(root, catalogFile + ".sig", "Synthetic signature file")
  for (const [path, text] of Object.entries(pluginTree)) await file(root, path, text)
  const directSource: PluginMarketplaceSourceInput = { kind: "directory", path: root }
  const catalog = await loadPluginMarketplaceCatalog(directSource)
  const entry = catalog.entries[0]
  if (!entry) throw new Error("缺少根插件")
  const direct = await loadPluginMarketplaceEntry(directSource, entry)
  expect([...direct.files.keys()]).toEqual(["skills/notes/SKILL.md"])
  await expect(loadPluginMarketplaceCatalogBytes(directSource)).resolves.toEqual(Buffer.from(json))
  const remoteJson = JSON.stringify({
    name: "fixture-market",
    plugins: [{ name: "notes", source: "./", pigclaude: { sha256: direct.digest } }],
  })
  const bytes = await archive("fixture-wrapper", { ...pluginTree, [catalogFile]: remoteJson })
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(reply(bytes))
    .mockResolvedValueOnce(reply(bytes))
  const https: PluginMarketplaceSourceInput = {
    kind: "https",
    url: "https://example.test/catalog.tgz",
    sha256: digest(bytes),
  }
  await expect(loadPluginMarketplaceCatalogBytes(https, fetcher)).resolves.toEqual(
    Buffer.from(remoteJson),
  )
  const pinned = parsePluginMarketplaceCatalog(Buffer.from(remoteJson)).entries[0]
  if (!pinned) throw new Error("缺少带指纹的相对条目")
  const loaded = await loadPluginMarketplaceEntry(https, pinned, fetcher)
  expect(loaded.files).toEqual(direct.files)
  expect(loaded.digest).toBe(direct.digest)
  expect(loaded.archiveSha256).toBe(digest(bytes))
})

it("流式下载实际字节过大时取消，不能靠缺失长度声明跳过限额", async () => {
  const cancelled = vi.fn()
  const chunk = new Uint8Array(1024 * 1024)
  let received = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (received >= pluginArchiveLimits.inputBytes + 2 * chunk.byteLength) {
        controller.close()
        return
      }
      received += chunk.byteLength
      controller.enqueue(chunk)
    },
    cancel: cancelled,
  })
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body))
  await expect(
    loadPluginMarketplaceCatalog(
      {
        kind: "github",
        repo: "fixture/market",
        commit: catalogCommit,
      },
      fetcher,
    ),
  ).rejects.toThrow("PLUGIN_ARCHIVE_TOO_LARGE")
  expect(cancelled).toHaveBeenCalledOnce()
})

it.each([
  { kind: "github", repo: "fixture/market", commit: "main" },
  { kind: "github", repo: "https://github.com/fixture/market", commit: catalogCommit },
  { kind: "https", url: "http://example.test/catalog.tgz", sha256: "0".repeat(64) },
  { kind: "https", url: "https://operator@example.test/catalog.tgz", sha256: "0".repeat(64) },
  { kind: "https", url: "https://example.test/catalog.tgz" },
  { kind: "directory", path: "./fixture" },
  { kind: "npm", name: "fixture" },
])("来源形状无效时拒绝，不查文件或联网 (%j)", (input) => {
  expect(() => normalizePluginMarketplaceSource(input)).toThrow("PLUGIN_MARKETPLACE_SOURCE_INVALID")
})

it.each([
  { source: "github", repo: "fixture/market", ref: "main" },
  { source: "archive", url: "https://example.test/fixture.tgz" },
  { source: "unknown" },
  "./missing//fixture",
  "./.git",
])("目录拒绝未固定、歧义或无效的条目 (%j)", (source) => {
  expect(() =>
    parsePluginMarketplaceCatalog(
      Buffer.from(
        JSON.stringify({
          name: "fixture-market",
          plugins: [{ name: "fixture", source }],
        }),
      ),
    ),
  ).toThrow("PLUGIN_MARKETPLACE_CATALOG_INVALID")
})

it("混合目录继续列出支持的条目，跳过明确不支持的来源", () => {
  const rows = [
    { name: "supported", source: "./plugins/supported" },
    { name: "from-npm", source: { source: "npm" }, pigclaude: { kind: "unused" } },
    { name: "from-command", source: { source: "command" } },
    { name: "from-url", source: { source: "url", url: "https://example.test/fixture" } },
    { name: "from-subdir", source: { source: "git-subdir" } },
  ]
  const parse = (plugins: unknown[]) =>
    parsePluginMarketplaceCatalog(
      Buffer.from(
        JSON.stringify({
          name: "fixture-market",
          plugins,
        }),
      ),
    )
  expect(parse(rows).entries.map(({ info }) => info.id)).toEqual(["supported"])
  expect(() => parse([...rows, { name: "from-npm", source: "./plugins/supported" }])).toThrow(
    "PLUGIN_MARKETPLACE_CATALOG_INVALID",
  )
})

it.skipIf(process.platform === "win32")("市场元数据的父目录不能是指向另一位置的链接", async () => {
  const root = await temp()
  const metadata = await temp()
  await file(metadata, "marketplace.json", '{"name":"fixture","plugins":[]}')
  await symlink(metadata, join(root, ".claude-plugin"), "dir")
  await expect(loadPluginMarketplaceCatalog({ kind: "directory", path: root })).rejects.toThrow(
    "PLUGIN_MARKETPLACE_SOURCE_UNAVAILABLE",
  )
})

it.skipIf(process.platform === "win32")("开发目录中的相对条目不转向有链接的另一目录", async () => {
  const source = await temp()
  const another = await temp()
  await file(another, "skills/notes/SKILL.md", "Synthetic fixture.")
  await mkdir(join(source, "plugins"))
  await symlink(another, join(source, "plugins", "notes"), "dir")
  const json = Buffer.from(
    JSON.stringify({
      name: "fixture-market",
      plugins: [{ name: "notes", source: "./plugins/notes" }],
    }),
  )
  const entry = parsePluginMarketplaceCatalog(json).entries[0]
  if (!entry) throw new Error("缺少相对目录条目")
  await expect(
    loadPluginMarketplaceEntry({ kind: "directory", path: source }, entry),
  ).rejects.toThrow("PLUGIN_MARKETPLACE_ENTRY_UNAVAILABLE")
})

async function temp() {
  const root = await mkdtemp(join(tmpdir(), "pigclaude-plugin-marketplace-source-"))
  directories.push(root)
  return root
}

async function file(root: string, path: string, text: string): Promise<void> {
  const target = join(root, path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, text, "utf8")
}

async function archive(prefix: string, files: Record<string, string>): Promise<Buffer> {
  const root = await temp()
  for (const [path, text] of Object.entries(files)) await file(root, prefix + "/" + path, text)
  const target = join(root, "fixture.tgz")
  await create({ cwd: root, gzip: true, portable: true, file: target }, [prefix])
  return readFile(target)
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function reply(bytes: Buffer): Response {
  return new Response(new Uint8Array(bytes))
}
