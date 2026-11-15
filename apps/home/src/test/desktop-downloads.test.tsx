// 验证公开下载页只使用正式 Release，并按平台显示可核对的安装包。
// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import DownloadPage from "@/app/download/page"
import { latestDesktopRelease } from "@/lib/desktop-downloads"

vi.mock("@/components/nav", () => ({ Nav: () => <nav aria-label="主导航" /> }))
vi.mock("@/components/landing/footer", () => ({ Footer: () => null }))
vi.mock("next/cache", () => ({ unstable_cache: (load: unknown) => load }))

const api = "https://api.github.com/repos/pigclaude/release/releases/latest"
const tag = "v1.2.3"
const base = `https://github.com/pigclaude/release/releases/download/${tag}`
const hashes = ["a".repeat(64), "b".repeat(64), "c".repeat(64)]
const files = ["PigClaude-1.2.3-arm64.dmg", "PigClaude-1.2.3-x64.exe", "PigClaude-x86_64.AppImage"]
const checksumFile = { name: "SHA256SUMS.txt", state: "uploaded", size: 500 }
const assets = [
  ...files.map((name, index) => ({
    name,
    state: "uploaded",
    size: 102_400_000,
    digest: `sha256:${hashes[index]}`,
    browser_download_url: "https://unrelated.example/ignored",
  })),
  { name: "PigClaude-1.2.3-arm64.zip", state: "uploaded", size: 42, digest: `sha256:${hashes[0]}` },
  checksumFile,
]

function published(overrides: Record<string, unknown> = {}) {
  return Response.json({ tag_name: tag, draft: false, prerelease: false, assets, ...overrides })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("官网公开下载", () => {
  it("游客可看到三个平台、版本和 SHA-256，链接只指向正式安装包", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(published())
    vi.stubGlobal("fetch", fetcher)
    render(await DownloadPage())

    expect(screen.getByRole("heading", { name: "下载 PigClaude" })).toBeTruthy()
    expect(screen.getByText(tag)).toBeTruthy()
    for (const [index, platform] of ["macOS", "Windows", "Linux"].entries()) {
      const section = screen.getByRole("region", { name: platform })
      const link = within(section).getByRole("link", { name: `下载 ${platform} 安装包` })
      expect(link.getAttribute("href")).toBe(`${base}/${files[index]}`)
      expect(within(section).getByText(hashes[index] ?? "")).toBeTruthy()
    }
    expect(screen.getByText("Apple 芯片 · ARM64")).toBeTruthy()
    expect(screen.queryByText("PigClaude-1.2.3-arm64.zip")).toBeNull()
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      api,
      expect.objectContaining({ credentials: "omit", cache: "no-store" }),
    )
  })

  it("公开仓库尚无正式版时显示状态，提供发布记录链接", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })),
    )
    render(await DownloadPage())
    expect(screen.getByText("暂无公开安装包")).toBeTruthy()
    expect(screen.queryByRole("link", { name: /下载安装包/ })).toBeNull()
    expect(screen.getByRole("link", { name: "查看发布记录" }).getAttribute("href")).toBe(
      "https://github.com/pigclaude/release/releases",
    )
  })

  it.each([{ draft: true }, { prerelease: true }, { tag_name: "desktop-v1.2.3-test.2" }])(
    "跳过测试或未公开的发布 %o",
    async (override) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(published(override))
      expect(await latestDesktopRelease(fetcher)).toEqual({ status: "unreleased" })
    },
  )

  it("部分平台附件或校验值缺失时，仅提供可核对的安装包", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        published({
          assets: [
            assets[0],
            { ...assets[1], digest: null },
            { ...assets[2], state: "starter" },
            checksumFile,
          ],
        }),
      )
      .mockResolvedValueOnce(new Response(`${hashes[1]}  ${files[1]}\n`))
    vi.stubGlobal("fetch", fetcher)
    render(await DownloadPage())

    const windows = screen.getByRole("region", { name: "Windows" })
    expect(within(windows).getByText(hashes[1] ?? "")).toBeTruthy()
    expect(within(windows).getByRole("link", { name: "下载 Windows 安装包" })).toBeTruthy()
    const linux = screen.getByRole("region", { name: "Linux" })
    expect(within(linux).getByText("此平台的安装包暂不可用")).toBeTruthy()
    expect(within(linux).queryByRole("link")).toBeNull()
  })

  it("查询失败时保留下载页面", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("private error")))
    render(await DownloadPage())
    expect(screen.getByText("暂时无法读取发布信息")).toBeTruthy()
    expect(screen.queryByText(/private error/)).toBeNull()
  })

  it("校验清单的实际内容超出上限时，拒绝用它生成下载数据", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(published({ assets: [{ ...assets[0], digest: null }, checksumFile] }))
      .mockResolvedValueOnce(new Response(`${hashes[0]}  ${files[0]}\n` + " ".repeat(64_000)))
    expect(await latestDesktopRelease(fetcher)).toEqual({ status: "unavailable" })
  })
})
