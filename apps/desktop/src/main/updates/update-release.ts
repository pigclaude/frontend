// 负责从公开发布仓库读出最新的正式版本：版本号、发布页和附件，以及版本先后的比较。

/** 公开发布仓库最新正式版本的接口；草稿和预发布不会出现在这里。 */
export const LATEST_RELEASE_API = "https://api.github.com/repos/pigclaude/release/releases/latest"

/** 公开发布仓库的最新版本页，检查失败又不知道新版本时让用户从这里下载。 */
export const LATEST_RELEASE_PAGE = "https://github.com/pigclaude/release/releases/latest"

/** 发布里附带的一个文件。 */
export type ReleaseAsset = {
  name: string
  url: string
}

/** 最新的正式版本：版本号不带 v，发布页地址，以及附件。 */
export type LatestRelease = {
  version: string
  url: string
  assets: ReleaseAsset[]
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/

/** latest 是否严格高于 current；任何一边不是 x.y.z 时都不算更新，所以不会降级。 */
export function isNewer(latest: string, current: string): boolean {
  const next = VERSION.exec(latest)
  const now = VERSION.exec(current)
  if (!next || !now) return false
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(next[index]) - Number(now[index])
    if (difference !== 0) return difference > 0
  }
  return false
}

/** 从发布接口的响应里取版本、发布页和附件；不合约定的响应返回 null。 */
export function readRelease(value: unknown): LatestRelease | null {
  if (!isRecord(value) || value.draft === true || value.prerelease === true) return null
  const tag = typeof value.tag_name === "string" ? value.tag_name.trim() : ""
  if (!VERSION.test(tag) || typeof value.html_url !== "string") return null
  if (!isReleasePage(value.html_url)) return null
  const assets = Array.isArray(value.assets) ? value.assets.flatMap(readAsset) : []
  return { version: tag.replace(/^v/, ""), url: value.html_url, assets }
}

/**
 * 读取最新的正式版本。仓库还没有正式版本（404）时返回 null；网络错误、超时和其他状态抛出，
 * 由调用方记为检查失败。不带任何凭据。
 */
export async function fetchLatestRelease(
  apiUrl: string,
  fetchImpl: typeof fetch,
): Promise<LatestRelease | null> {
  const response = await fetchImpl(apiUrl, {
    headers: { accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`release check failed: HTTP ${response.status}`)
  const release = readRelease(await response.json())
  if (!release) throw new Error("release check failed: unexpected response")
  return release
}

/** GitHub 给的地址都是 https；明文只放行本机回环，测试才能用本地假更新源。 */
export function isDownloadUrl(value: string): boolean {
  const parsed = parseUrl(value)
  if (!parsed) return false
  return parsed.protocol === "https:" || isLoopback(parsed)
}

/** 主进程会用系统浏览器打开发布页，所以只接受公开发布仓库自己的页面（测试时为本机回环）。 */
function isReleasePage(value: string): boolean {
  const parsed = parseUrl(value)
  if (!parsed) return false
  if (isLoopback(parsed)) return true
  return (
    parsed.protocol === "https:" &&
    parsed.host === "github.com" &&
    parsed.pathname.startsWith("/pigclaude/release/releases/")
  )
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function isLoopback(url: URL): boolean {
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
}

function readAsset(value: unknown): ReleaseAsset[] {
  if (!isRecord(value)) return []
  const { name, browser_download_url: url } = value
  if (typeof name !== "string" || typeof url !== "string" || !isDownloadUrl(url)) return []
  return [{ name, url }]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
