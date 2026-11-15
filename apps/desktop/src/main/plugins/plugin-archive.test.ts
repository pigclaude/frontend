// 用合成的能力插件包核对归档哈希、归档类型、路径与读取上限。

import { createHash } from "node:crypto"
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { crc32, deflateRawSync, gzipSync } from "node:zlib"
import { Header, type HeaderData } from "tar"
import { afterEach, expect, it } from "vitest"
import { pluginArchiveLimits } from "./plugin-archive-entries"
import { readCapabilityPluginArchive } from "./plugin-archive"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function writeFixture(data: Buffer, name = "plugin.tgz") {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-plugin-archive-"))
  directories.push(directory)
  const path = join(directory, name)
  await writeFile(path, data)
  return { path, sha256: createHash("sha256").update(data).digest("hex") }
}

type FixtureTarEntry = {
  name: string
  body?: Buffer | string
  type?: HeaderData["type"]
  linkpath?: string
}

function tarArchive(entries: readonly FixtureTarEntry[]): Buffer {
  const blocks: Buffer[] = []
  for (const { name, body, type, linkpath } of entries) {
    const data = Buffer.from(body ?? "")
    const block = Buffer.alloc(512)
    const header = new Header({
      path: name,
      type: type ?? "File",
      size: data.length,
      ...(linkpath ? { linkpath } : {}),
    })
    header.encode(block)
    blocks.push(block, data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]))
}

it("校验 tgz 哈希后从单一发布目录返回相对文件路径", async () => {
  const { path, sha256 } = await writeFixture(
    tarArchive([
      { name: "./", type: "Directory" },
      { name: "fixture-release/", type: "Directory" },
      { name: "fixture-release/pigclaude-plugin.json", body: "{}" },
      { name: "fixture-release/modules/main.mjs", body: "export default () => 1" },
    ]),
  )
  const files = await readCapabilityPluginArchive(path, sha256.toUpperCase())
  expect(files).toEqual(
    new Map([
      ["pigclaude-plugin.json", Buffer.from("{}")],
      ["modules/main.mjs", Buffer.from("export default () => 1")],
    ]),
  )
})

it("无清单且只有 skills 的包保留标准目录名", async () => {
  const name = "skills/fixture/SKILL.md"
  const body = "合成说明"
  for (const make of [tarArchive, zipArchive]) {
    const { path, sha256 } = await writeFixture(make([{ name, body }]))
    expect(await readCapabilityPluginArchive(path, sha256)).toEqual(
      new Map([[name, Buffer.from(body)]]),
    )
  }
})

type FixtureZipEntry = {
  name: string
  body?: string
  mode?: number
  deflated?: boolean
  descriptor?: boolean
  declaredSize?: number
}

function zipArchive(entries: readonly FixtureZipEntry[]): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const filename = Buffer.from(entry.name)
    const data = Buffer.from(entry.body ?? "")
    const compressed = entry.deflated ? deflateRawSync(data) : data
    const flags = 0x0800 | (entry.descriptor ? 0x08 : 0)
    const method = entry.deflated ? 8 : 0
    const size = entry.declaredSize ?? data.length
    const checksum = crc32(data)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(flags, 6)
    localHeader.writeUInt16LE(method, 8)
    localHeader.writeUInt16LE(filename.length, 26)
    const payload = [localHeader, filename, compressed]
    if (entry.descriptor) {
      const trailer = Buffer.alloc(16)
      trailer.writeUInt32LE(0x08074b50, 0)
      trailer.writeUInt32LE(checksum, 4)
      trailer.writeUInt32LE(compressed.length, 8)
      trailer.writeUInt32LE(size, 12)
      payload.push(trailer)
    } else {
      localHeader.writeUInt32LE(checksum, 14)
      localHeader.writeUInt32LE(compressed.length, 18)
      localHeader.writeUInt32LE(size, 22)
    }
    local.push(...payload)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50, 0)
    directory.writeUInt16LE(0x0314, 4)
    directory.writeUInt16LE(20, 6)
    directory.writeUInt16LE(flags, 8)
    directory.writeUInt16LE(method, 10)
    directory.writeUInt32LE(checksum, 16)
    directory.writeUInt32LE(compressed.length, 20)
    directory.writeUInt32LE(size, 24)
    directory.writeUInt16LE(filename.length, 28)
    directory.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38)
    directory.writeUInt32LE(offset, 42)
    central.push(directory, filename)
    offset += payload.reduce((total, part) => total + part.length, 0)
  }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(
    central.reduce((total, part) => total + part.length, 0),
    12,
  )
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, ...central, end])
}

it("保留 zip 包根文件，解读存储文件和带数据描述符的 Deflate 文件", async () => {
  const { path, sha256 } = await writeFixture(
    zipArchive([
      { name: "pigclaude-plugin.json", body: "{}" },
      {
        name: "modules/main.mjs",
        body: "export default () => 42",
        deflated: true,
        descriptor: true,
      },
      { name: "modules/", mode: 0o040755 },
    ]),
    "plugin.zip",
  )
  expect(await readCapabilityPluginArchive(path, sha256)).toEqual(
    new Map([
      ["pigclaude-plugin.json", Buffer.from("{}")],
      ["modules/main.mjs", Buffer.from("export default () => 42")],
    ]),
  )
})

it("坏格式也先校验摘要，固定错误码不暴露本机路径", async () => {
  const { path, sha256 } = await writeFixture(Buffer.from("invalid fixture archive"))
  await expect(readCapabilityPluginArchive(path, "none")).rejects.toMatchObject({
    message: "PLUGIN_ARCHIVE_SHA256_INVALID",
  })
  await expect(readCapabilityPluginArchive(path, "0".repeat(64))).rejects.toMatchObject({
    message: "PLUGIN_ARCHIVE_SHA256_MISMATCH",
  })
  await expect(readCapabilityPluginArchive(path, sha256)).rejects.toMatchObject({
    message: "PLUGIN_ARCHIVE_INVALID",
  })
})

it.each(["../outside.mjs", "C:\\fixture.mjs", "/outside.mjs", "CON.js", "CON .js", "a/file. "])(
  "拒绝两种归档中不可安全安装的路径 %s",
  async (name) => {
    for (const make of [tarArchive, zipArchive]) {
      const { path, sha256 } = await writeFixture(make([{ name, body: "fixture" }]))
      await expect(readCapabilityPluginArchive(path, sha256)).rejects.toMatchObject({
        code: "PLUGIN_ARCHIVE_UNSAFE",
      })
    }
  },
)

it.each(["SymbolicLink", "Link"] as const)("拒绝 tar 的 %s 条目", async (type) => {
  const { path, sha256 } = await writeFixture(
    tarArchive([
      { name: "main.js", body: "fixture" },
      { name: "linked.js", type, linkpath: "main.js" },
    ]),
  )
  await expect(readCapabilityPluginArchive(path, sha256)).rejects.toMatchObject({
    code: "PLUGIN_ARCHIVE_UNSAFE",
  })
})

it("拒绝 zip 的符号链接类型", async () => {
  const { path, sha256 } = await writeFixture(
    zipArchive([{ name: "linked.js", mode: 0o120777, body: "main.js" }]),
  )
  await expect(readCapabilityPluginArchive(path, sha256)).rejects.toMatchObject({
    code: "PLUGIN_ARCHIVE_UNSAFE",
  })
})

it.each([
  ["release/Main.js", "release/main.js"],
  ["release/main.js", "release/./main.js"],
  ["release/main", "release/main/mod.js"],
  ["release/a.js", "Release/b.js"],
])("拒绝跨平台重复和路径类型冲突 (%s / %s)", async (a, b) => {
  const { path, sha256 } = await writeFixture(
    zipArchive([
      { name: a, body: "a" },
      { name: b, body: "b" },
    ]),
  )
  await expect(readCapabilityPluginArchive(path, sha256)).rejects.toMatchObject({
    code: "PLUGIN_ARCHIVE_UNSAFE",
  })
})

it("拒绝截断的 zip 与正文校验和错误", async () => {
  const sample = zipArchive([{ name: "main.js", body: "fixture" }])
  const corrupted = Buffer.from(sample)
  corrupted[30 + Buffer.byteLength("main.js")] = 0
  for (const bytes of [sample.subarray(0, -1), corrupted]) {
    const { path, sha256 } = await writeFixture(bytes)
    await expect(readCapabilityPluginArchive(path, sha256)).rejects.toMatchObject({
      code: "PLUGIN_ARCHIVE_INVALID",
    })
  }
})

it("读取前拒绝超过压缩体积上限的文件", async () => {
  const { path, sha256 } = await writeFixture(Buffer.alloc(0))
  await truncate(path, pluginArchiveLimits.inputBytes + 1)
  await expect(readCapabilityPluginArchive(path, sha256)).rejects.toMatchObject({
    code: "PLUGIN_ARCHIVE_TOO_LARGE",
  })
})

it("解压 zip 前限制声明的单文件与总大小", async () => {
  const limit = pluginArchiveLimits.fileBytes
  for (const declarations of [[limit + 1], Array.from({ length: 5 }, () => limit)]) {
    const { path, sha256 } = await writeFixture(
      zipArchive(
        declarations.map((declaredSize, index) => ({
          name: `module-${index}.js`,
          body: "fixture",
          deflated: true,
          declaredSize,
        })),
      ),
    )
    await expect(readCapabilityPluginArchive(path, sha256)).rejects.toMatchObject({
      code: "PLUGIN_ARCHIVE_TOO_LARGE",
    })
  }
})

it("tgz 不允许用目录数量绕开条目上限", async () => {
  const { path, sha256 } = await writeFixture(
    tarArchive(
      Array.from({ length: pluginArchiveLimits.entries + 1 }, (_, index) => ({
        name: `dir-${index}/`,
        type: "Directory",
      })),
    ),
  )
  await expect(readCapabilityPluginArchive(path, sha256)).rejects.toMatchObject({
    code: "PLUGIN_ARCHIVE_TOO_LARGE",
  })
})

it("解压字节超过上限时停止读取，不相信 ZIP 的声明大小", async () => {
  const { path, sha256 } = await writeFixture(
    zipArchive([{ name: "main.js", body: "fixture", deflated: true, declaredSize: 1 }]),
  )
  await expect(readCapabilityPluginArchive(path, sha256)).rejects.toMatchObject({
    code: "PLUGIN_ARCHIVE_TOO_LARGE",
  })
})

it("gzip 在尝试读取 tar 记录之前限制解压总字节数", async () => {
  const { path, sha256 } = await writeFixture(
    gzipSync(Buffer.alloc(pluginArchiveLimits.expandedBytes + 1)),
  )
  await expect(readCapabilityPluginArchive(path, sha256)).rejects.toMatchObject({
    code: "PLUGIN_ARCHIVE_TOO_LARGE",
  })
})
