// 负责渲染不依赖登录的官网安装包下载页。

import type { Metadata } from "next"
import { unstable_cache } from "next/cache"
import { Download, ExternalLink } from "lucide-react"
import { Button } from "@pigclaude/web-ui/components/button"
import { Footer } from "@/components/landing/footer"
import { Nav } from "@/components/nav"
import {
  desktopReleasesPage,
  latestDesktopRelease,
  type DesktopDownload,
  type DesktopRelease,
} from "@/lib/desktop-downloads"

/** 告知搜索和浏览器当前页面是 PigClaude 安装包入口。 */
export const metadata: Metadata = {
  title: "下载 PigClaude",
  description: "下载适用于 macOS、Windows 或 Linux 的 PigClaude 安装包。",
}

/** 每次访问渲染页面，下载数据由独立缓存控制。 */
export const revalidate = 0

const cachedRelease = unstable_cache(
  async () => {
    const release = await latestDesktopRelease()
    if (release.status === "unavailable") throw new Error("暂时无法读取发布信息")
    return release
  },
  ["pigclaude-desktop-downloads"],
  { revalidate: 300 },
)

/** 直接展示公开发布记录和该版本的三个平台，无需网站会话。 */
export default async function DownloadPage() {
  const release = await cachedRelease().catch((): DesktopRelease => ({ status: "unavailable" }))
  return (
    <>
      <Nav variant="marketing" />
      <main className="min-h-[60vh] py-12 md:py-20">
        <div className="landing-container">
          <header className="mb-10 grid gap-4">
            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">下载 PigClaude</h1>
            <p className="text-base text-muted-foreground">选择适合你设备的安装包。</p>
          </header>
          {release.status === "available" ? (
            <>
              <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <span className="font-medium">{release.tag}</span>
                <ReleaseLink href={release.releaseUrl}>发布说明</ReleaseLink>
                {release.checksumsUrl && (
                  <ReleaseLink href={release.checksumsUrl}>SHA-256 校验清单</ReleaseLink>
                )}
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {release.downloads.map((download) => (
                  <DownloadCard key={download.platform} download={download} />
                ))}
              </div>
            </>
          ) : (
            <div className="grid max-w-lg gap-3 rounded-xl border border-border bg-card p-6">
              <p role="status" className="text-base font-medium">
                {release.status === "unreleased" ? "暂无公开安装包" : "暂时无法读取发布信息"}
              </p>
              <ReleaseLink href={desktopReleasesPage}>查看发布记录</ReleaseLink>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  )
}

function ReleaseLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      className="inline-flex w-fit items-center gap-1.5 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      {children}
      <ExternalLink aria-hidden className="size-3.5" />
    </a>
  )
}

function DownloadCard({ download }: { download: DesktopDownload }) {
  const { platform, architecture, asset } = download
  return (
    <section
      aria-label={platform}
      className="grid min-w-0 content-start gap-5 rounded-xl border border-border bg-card p-5 md:p-6"
    >
      <div className="grid gap-1">
        <h2 className="text-xl font-semibold">{platform}</h2>
        <p className="text-sm text-muted-foreground">{architecture}</p>
      </div>
      {asset ? (
        <>
          <Button asChild className="justify-self-start">
            <a href={asset.url}>
              <Download aria-hidden className="size-4" />
              下载 {platform} 安装包
            </a>
          </Button>
          <div className="grid gap-2 text-sm text-muted-foreground">
            <p className="[overflow-wrap:anywhere]">
              {asset.name} · {(asset.bytes / 1_000_000).toFixed(1)} MB
            </p>
            <dl className="grid gap-1">
              <dt>SHA-256</dt>
              <dd>
                <code className="font-mono text-xs [overflow-wrap:anywhere]">{asset.sha256}</code>
              </dd>
            </dl>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">此平台的安装包暂不可用</p>
      )}
    </section>
  )
}
