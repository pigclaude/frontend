// 验证发布说明：列出三平台安装包和 sha256，写明随包内核和不签名的限制，测试发布开头标明不是正式版本。
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

type Installer = { platform: string; name: string; sha256: string }
type ReleaseNotes = {
  installerDigests(directory: string): Installer[]
  releaseNotes(input: {
    version: string
    test: boolean
    installers: Installer[]
    pigbrowserVersion: string
  }): string
}

const notes = createRequire(import.meta.url)(
  resolve(import.meta.dirname, "../../release-notes.cjs"),
) as ReleaseNotes

describe("发布说明", () => {
  let directory = ""

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  async function release(names: string[]): Promise<string> {
    directory = await mkdtemp(join(tmpdir(), "pigclaude-release-notes-"))
    for (const name of names) await writeFile(join(directory, name), "abc")
    return directory
  }

  it("列出三个平台的安装包和 sha256，写明内核版本和不签名的限制", async () => {
    const dir = await release([
      "PigClaude-1.0.0-arm64.dmg",
      "PigClaude-1.0.0-x64.exe",
      "PigClaude-x86_64.AppImage",
    ])
    const installers = notes.installerDigests(dir)
    const sha256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    expect(installers).toEqual([
      { platform: "macOS（Apple 芯片）", name: "PigClaude-1.0.0-arm64.dmg", sha256 },
      { platform: "Windows x64", name: "PigClaude-1.0.0-x64.exe", sha256 },
      { platform: "Linux x64", name: "PigClaude-x86_64.AppImage", sha256 },
    ])
    const text = notes.releaseNotes({
      version: "1.0.0",
      test: false,
      installers,
      pigbrowserVersion: "156.0.8078.88",
    })
    expect(text.startsWith("PigClaude 1.0.0")).toBe(true)
    expect(text).toContain(`| Linux x64 | \`PigClaude-x86_64.AppImage\` | \`${sha256}\` |`)
    expect(text).toContain("PigBrowser 156.0.8078.88")
    expect(text).toContain("macOS 不能自动安装更新")
    expect(text).toContain("SmartScreen")
  })

  it("测试发布在开头标明不是正式版本", () => {
    const text = notes.releaseNotes({
      version: "0.0.1",
      test: true,
      installers: [],
      pigbrowserVersion: "156.0.8078.88",
    })
    expect(text.split("\n")[0]).toContain("测试发布")
    expect(text.split("\n")[0]).toContain("不是正式版本")
  })

  it("缺少任何一个平台的安装包时报错", async () => {
    const dir = await release(["PigClaude-1.0.0-arm64.dmg", "PigClaude-1.0.0-x64.exe"])
    expect(() => notes.installerDigests(dir)).toThrow("缺少 Linux x64 安装包")
  })
})
