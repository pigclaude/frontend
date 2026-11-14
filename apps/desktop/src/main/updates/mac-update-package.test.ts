// 验证 macOS 更新包：读取 electron-builder 的更新清单，按芯片挑 DMG，下载失败时不留下半个文件。
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { startFakeUpdateSource, type FakeUpdateSource } from "../testing/fake-update-source"
import { downloadVerifiedPackage, parseUpdateManifest, pickMacPackage } from "./mac-update-package"
import type { LatestRelease } from "./update-release"

const manifest = [
  "version: 1.1.0",
  "files:",
  "  - url: PigClaude-1.1.0-arm64.zip",
  "    sha512: zipsha",
  "    size: 10",
  "  - url: PigClaude-1.1.0-arm64.dmg",
  "    sha512: dmgsha",
  "    size: 20",
  "    blockMapSize: 5",
  "path: PigClaude-1.1.0-arm64.zip",
  "sha512: zipsha",
  "releaseDate: '2026-11-14T11:14:03.484Z'",
  "",
].join("\n")

const release: LatestRelease = {
  version: "1.1.0",
  url: "https://github.com/pigclaude/release/releases/tag/v1.1.0",
  assets: [{ name: "PigClaude-1.1.0-arm64.dmg", url: "https://example.test/dmg" }],
}

describe("更新清单", () => {
  it("读出版本和每个文件的 sha512 与大小", () => {
    expect(parseUpdateManifest(manifest)).toEqual({
      version: "1.1.0",
      files: [
        { url: "PigClaude-1.1.0-arm64.zip", sha512: "zipsha", size: 10 },
        { url: "PigClaude-1.1.0-arm64.dmg", sha512: "dmgsha", size: 20 },
      ],
    })
  })

  it("按芯片挑出清单和附件里都有的 DMG", () => {
    expect(pickMacPackage(manifest, release, "arm64")).toEqual({
      name: "PigClaude-1.1.0-arm64.dmg",
      url: "https://example.test/dmg",
      sha512: "dmgsha",
      size: 20,
    })
    expect(pickMacPackage(manifest, release, "x64")).toBeNull()
    expect(pickMacPackage(manifest, { ...release, version: "1.2.0" }, "arm64")).toBeNull()
    expect(pickMacPackage(manifest, { ...release, assets: [] }, "arm64")).toBeNull()
  })
})

describe("下载 DMG", () => {
  let source: FakeUpdateSource | null = null
  let directory = ""

  afterEach(async () => {
    await source?.close()
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  it("服务器返回错误时抛出，目录里不留下文件", async () => {
    source = await startFakeUpdateSource({ version: "1.1.0", dmgStatus: 500 })
    directory = await mkdtemp(join(tmpdir(), "pigclaude-mac-package-"))
    const pkg = {
      name: "PigClaude-1.1.0-arm64.dmg",
      url: source.apiUrl.replace("/releases/latest", "/download/PigClaude-1.1.0-arm64.dmg"),
      sha512: "x",
      size: 1,
    }
    await expect(downloadVerifiedPackage(pkg, directory)).rejects.toThrow("HTTP 500")
    await expect(readdir(directory)).resolves.toEqual([])
  })
})
