// 验证发布制品核对：三平台更新清单与安装包的版本、大小和 sha512 一致，缺少或被换过时逐条报出。
import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

type ReleaseAssets = {
  parseUpdateManifest(text: string): { version: string | null; files: { url: string }[] }
  releaseAssetProblems(directory: string, version: string): string[]
}

const check = createRequire(import.meta.url)(
  resolve(import.meta.dirname, "../../release-assets.cjs"),
) as ReleaseAssets

describe("更新清单与安装包", () => {
  let directory = ""

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  async function release(files: Record<string, string>): Promise<string> {
    directory = await mkdtemp(join(tmpdir(), "pigclaude-release-assets-"))
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(directory, name), content)
    }
    return directory
  }

  function manifest(version: string, entries: [string, string][]): string {
    const files = entries.flatMap(([url, content]) => [
      `  - url: ${url}`,
      `    sha512: ${sha512Of(content)}`,
      `    size: ${Buffer.byteLength(content)}`,
    ])
    return [`version: ${version}`, "files:", ...files, `path: ${entries[0]?.[0]}`, ""].join("\n")
  }

  function sha512Of(content: string): string {
    return createHash("sha512").update(content).digest("base64")
  }

  const installers: Record<string, string> = {
    "PigClaude-1.0.0-arm64.zip": "zip",
    "PigClaude-1.0.0-arm64.dmg": "dmg",
    "PigClaude-1.0.0-x64.exe": "exe",
    "PigClaude-x86_64.AppImage": "appimage",
  }

  function manifests(version: string): Record<string, string> {
    return {
      "latest-mac.yml": manifest(version, [
        ["PigClaude-1.0.0-arm64.zip", "zip"],
        ["PigClaude-1.0.0-arm64.dmg", "dmg"],
      ]),
      "latest.yml": manifest(version, [["PigClaude-1.0.0-x64.exe", "exe"]]),
      "latest-linux.yml": manifest(version, [["PigClaude-x86_64.AppImage", "appimage"]]),
    }
  }

  it("三份清单的版本、文件、大小和 sha512 都和安装包一致时通过", async () => {
    const dir = await release({ ...installers, ...manifests("1.0.0") })
    expect(check.releaseAssetProblems(dir, "1.0.0")).toEqual([])
  })

  it("安装包被换过、清单版本不对、缺少平台时逐条报出", async () => {
    const files = { ...installers, ...manifests("0.9.0") }
    files["PigClaude-1.0.0-x64.exe"] = "tampered"
    delete files["latest-linux.yml"]
    const dir = await release(files)
    expect(check.releaseAssetProblems(dir, "1.0.0")).toEqual([
      "latest-mac.yml 的版本是 0.9.0，应为 1.0.0",
      "latest.yml 的版本是 0.9.0，应为 1.0.0",
      "PigClaude-1.0.0-x64.exe 的大小和 latest.yml 不一致",
      "PigClaude-1.0.0-x64.exe 的 sha512 和 latest.yml 不一致",
      "缺少更新清单 latest-linux.yml",
    ])
  })

  it("清单的版本带引号时也能读出", () => {
    const manifest = check.parseUpdateManifest('version: "1.2.3"\nfiles:\n  - url: a.exe\n')
    expect(manifest.version).toBe("1.2.3")
    expect(manifest.files.map((file) => file.url)).toEqual(["a.exe"])
  })
})
