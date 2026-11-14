// 验证发布读取：只认比当前高的 x.y.z 正式版本，发布页只能是公开发布仓库的页面，附件只收 https 或本机回环。
import { describe, expect, it, vi } from "vitest"
import { fetchLatestRelease, isNewer, LATEST_RELEASE_API, readRelease } from "./update-release"

const release = {
  tag_name: "v1.2.0",
  html_url: "https://github.com/pigclaude/release/releases/tag/v1.2.0",
  draft: false,
  prerelease: false,
  assets: [
    { name: "latest.yml", browser_download_url: "https://github.com/pigclaude/release/a" },
    { name: "evil.exe", browser_download_url: "http://example.com/evil.exe" },
  ],
}

describe("版本先后", () => {
  it("只有严格更高的版本才算更新", () => {
    expect(isNewer("1.2.0", "1.1.9")).toBe(true)
    expect(isNewer("1.10.0", "1.9.0")).toBe(true)
    expect(isNewer("1.2.0", "1.2.0")).toBe(false)
    expect(isNewer("1.1.0", "1.2.0")).toBe(false)
    expect(isNewer("2.0.0-beta.1", "1.0.0")).toBe(false)
  })
})

describe("读取最新发布", () => {
  it("取出版本、发布页和合规的附件", () => {
    expect(readRelease(release)).toEqual({
      version: "1.2.0",
      url: "https://github.com/pigclaude/release/releases/tag/v1.2.0",
      assets: [{ name: "latest.yml", url: "https://github.com/pigclaude/release/a" }],
    })
  })

  it("草稿、预发布、坏 tag 和别处的页面都不收", () => {
    expect(readRelease({ ...release, draft: true })).toBeNull()
    expect(readRelease({ ...release, prerelease: true })).toBeNull()
    expect(readRelease({ ...release, tag_name: "desktop-v1.2.0-test.1" })).toBeNull()
    expect(
      readRelease({ ...release, html_url: "https://example.com/pigclaude/release/releases/x" }),
    ).toBeNull()
    expect(
      readRelease({ ...release, html_url: "https://github.com/someone/else/releases/tag/v1" }),
    ).toBeNull()
    expect(readRelease({ ...release, html_url: "javascript:alert(1)" })).toBeNull()
  })

  it("还没有正式版本时返回 null，其他错误抛出；请求不带凭据", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }))
    await expect(fetchLatestRelease(LATEST_RELEASE_API, fetchImpl)).resolves.toBeNull()
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toEqual({ accept: "application/vnd.github+json" })
    expect(init.credentials).toBeUndefined()

    const failing = async () => new Response("", { status: 503 })
    await expect(fetchLatestRelease(LATEST_RELEASE_API, failing)).rejects.toThrow("HTTP 503")
    const garbled = async () => new Response(JSON.stringify({ tag_name: "nope" }))
    await expect(fetchLatestRelease(LATEST_RELEASE_API, garbled)).rejects.toThrow()
  })
})
