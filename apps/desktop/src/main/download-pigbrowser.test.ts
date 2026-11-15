// 验证发版时从公开或私有 Release 下载 PigBrowser 开发包并核对固定 SHA-256。
import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Release = { repository: string; tag: string; archive: string; sha256: string }
type Run = (
  args: string[],
  env: Record<string, string>,
) => { status: number; stdout: string; stderr: string }
type DownloadPigbrowser = {
  pigbrowserRelease(target: string): Release
  fetchPigbrowserArchive(input: {
    release: Release
    dir: string
    token?: string
    run: Run
    fetcher?: typeof fetch
  }): Promise<string>
}

const script = createRequire(import.meta.url)(
  resolve(import.meta.dirname, "../../download-pigbrowser.cjs"),
) as DownloadPigbrowser

const content = "pigbrowser archive"
const release: Release = {
  repository: "pigbrowser/pigbrowser",
  tag: "v1.2.3",
  archive: "pigbrowser-1.2.3-linux-x64-dev-abc.tar.xz",
  sha256: createHash("sha256").update(content).digest("hex"),
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pigbrowser-download-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** 模拟 gh：view 返回给定的附件名，download 把给定内容写进 --dir。 */
function fakeGh(options: {
  assets?: string[]
  downloadError?: string
  draft?: boolean
  viewError?: string
  body?: string
}) {
  const calls: { args: string[]; env: Record<string, string> }[] = []
  const run: Run = (args, env) => {
    calls.push({ args, env })
    if (args[1] === "view") {
      if (options.viewError) return { status: 1, stdout: "", stderr: options.viewError }
      const names = options.assets ?? [release.archive]
      return {
        status: 0,
        stdout: JSON.stringify({
          isDraft: options.draft ?? false,
          assets: names.map((name) => ({ name })),
        }),
        stderr: "",
      }
    }
    if (options.downloadError) return { status: 1, stdout: "", stderr: options.downloadError }
    const target = args[args.indexOf("--dir") + 1]!
    const name = args[args.indexOf("--pattern") + 1]!
    writeFileSync(join(target, name), options.body ?? content)
    return { status: 0, stdout: "", stderr: "" }
  }
  return { run, calls }
}

describe("PigBrowser 开发包的下载来源", () => {
  it("来源取自 pigbrowser-artifacts.json：仓库、v<版本> 的 tag 和该平台的附件名", () => {
    expect(script.pigbrowserRelease("linux-x64")).toEqual({
      repository: "pigbrowser/pigbrowser",
      tag: "v156.0.8078.88",
      archive: "pigbrowser-156.0.8078.88-linux-x64-dev-0a54aa1.tar.xz",
      sha256: "f4156c6227ed5f1dc783bf025df5c3b2905902cee97324193c6851098530ea84",
    })
    expect(() => script.pigbrowserRelease("linux-arm64")).toThrow("未配置该平台的 PigBrowser 产物")
  })
})

function publicRelease(asset = release.archive) {
  return Response.json({ draft: false, assets: [{ name: asset, state: "uploaded" }] })
}

describe("从公开 Release 下载 PigBrowser 开发包", () => {
  it("不带凭据下载已公开的固定附件，校验后返回文件路径", async () => {
    const gh = fakeGh({})
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(publicRelease())
      .mockResolvedValueOnce(new Response(content))
    const path = await script.fetchPigbrowserArchive({
      release,
      dir,
      token: " ",
      run: gh.run,
      fetcher,
    })
    expect(path).toBe(join(dir, release.archive))
    expect(await readFile(path, "utf8")).toBe(content)
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://api.github.com/repos/pigbrowser/pigbrowser/releases/tags/v1.2.3",
      `https://github.com/pigbrowser/pigbrowser/releases/download/v1.2.3/${release.archive}`,
    ])
    expect(
      fetcher.mock.calls.every(([, init]) => !new Headers(init?.headers).has("authorization")),
    ).toBe(true)
    expect(gh.calls).toHaveLength(0)
  })

  it("无法匿名读取时提示私有仓可以配置只读令牌", async () => {
    const gh = fakeGh({})
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }))
    await expect(
      script.fetchPigbrowserArchive({ release, dir, run: gh.run, fetcher }),
    ).rejects.toThrow("PIGBROWSER_READ_TOKEN")
    expect(gh.calls).toHaveLength(0)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("公开 Release 缺少固定附件时不下载其他文件", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(publicRelease("other.zip"))
    await expect(
      script.fetchPigbrowserArchive({ release, dir, run: fakeGh({}).run, fetcher }),
    ).rejects.toThrow(`里没有已上传的附件 ${release.archive}`)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("下载到的哈希不匹配时保留已有的正确包", async () => {
    const path = join(dir, release.archive)
    writeFileSync(path, content)
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(publicRelease())
      .mockResolvedValueOnce(new Response("corrupted"))
    await expect(
      script.fetchPigbrowserArchive({ release, dir, run: fakeGh({}).run, fetcher }),
    ).rejects.toThrow("PigBrowser 包校验失败")
    expect(await readFile(path, "utf8")).toBe(content)
    expect(await readdir(dir)).toEqual([release.archive])
  })
})

describe("从私有 Release 下载 PigBrowser 开发包", () => {
  it("Release 不存在时报出仓库和 tag，并带上 gh 的原话", async () => {
    const gh = fakeGh({ viewError: "release not found\n" })
    await expect(
      script.fetchPigbrowserArchive({ release, dir, token: "t", run: gh.run }),
    ).rejects.toThrow("读取 pigbrowser/pigbrowser 的 Release v1.2.3 失败：release not found")
  })

  it("Release 还是草稿时说明要先发布，不去下载", async () => {
    const gh = fakeGh({ draft: true })
    await expect(
      script.fetchPigbrowserArchive({ release, dir, token: "t", run: gh.run }),
    ).rejects.toThrow("pigbrowser/pigbrowser 的 Release v1.2.3 还是草稿")
    expect(gh.calls).toHaveLength(1)
  })

  it("Release 里没有该平台的附件时报出附件名", async () => {
    const gh = fakeGh({ assets: ["other.zip"] })
    await expect(
      script.fetchPigbrowserArchive({ release, dir, token: "t", run: gh.run }),
    ).rejects.toThrow(`pigbrowser/pigbrowser 的 Release v1.2.3 里没有附件 ${release.archive}`)
  })

  it("下载失败时报出附件名和 gh 的原话", async () => {
    const gh = fakeGh({ downloadError: "HTTP 403\n" })
    await expect(
      script.fetchPigbrowserArchive({ release, dir, token: "t", run: gh.run }),
    ).rejects.toThrow(
      `下载 pigbrowser/pigbrowser 的 Release v1.2.3 的附件 ${release.archive} 失败：HTTP 403`,
    )
  })

  it("用令牌按 tag 和附件名下载，sha256 一致时返回包的路径", async () => {
    const gh = fakeGh({})
    const path = await script.fetchPigbrowserArchive({ release, dir, token: "secret", run: gh.run })
    expect(path).toBe(join(dir, release.archive))
    expect(gh.calls.map((call) => call.args)).toEqual([
      ["release", "view", "v1.2.3", "--repo", "pigbrowser/pigbrowser", "--json", "assets,isDraft"],
      [
        "release",
        "download",
        "v1.2.3",
        "--repo",
        "pigbrowser/pigbrowser",
        "--pattern",
        release.archive,
        "--dir",
        expect.stringContaining(join(dir, ".pigbrowser-")),
        "--clobber",
      ],
    ])
    expect(gh.calls.every((call) => call.env["GH_TOKEN"] === "secret")).toBe(true)
  })

  it("下载的包和固定的 sha256 对不上时删掉它并失败", async () => {
    const gh = fakeGh({ body: "tampered" })
    await expect(
      script.fetchPigbrowserArchive({ release, dir, token: "t", run: gh.run }),
    ).rejects.toThrow("PigBrowser 包校验失败")
    expect(await readdir(dir)).toEqual([])
  })
})
