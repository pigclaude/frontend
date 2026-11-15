// 负责从公开发布仓库读取正式版本，为三个平台选择带校验值的安装包。

const repository = "pigclaude/release"
const releaseApi = `https://api.github.com/repos/${repository}/releases/latest`

/** 指向 PigClaude 公开发布记录，供没有正式安装包时使用。 */
export const desktopReleasesPage = `https://github.com/${repository}/releases`

const platforms = [
  {
    platform: "macOS",
    architecture: "Apple 芯片 · ARM64",
    filename: (version: string) => `PigClaude-${version}-arm64.dmg`,
  },
  {
    platform: "Windows",
    architecture: "x64",
    filename: (version: string) => `PigClaude-${version}-x64.exe`,
  },
  {
    platform: "Linux",
    architecture: "x64",
    filename: () => "PigClaude-x64.AppImage",
  },
]

/** 某个平台及对应的官方安装文件。校验信息缺失时保留平台说明。 */
export type DesktopDownload = {
  platform: string
  architecture: string
  asset: {
    name: string
    url: string
    bytes: number
    sha256: string
  } | null
}

/** 下载页需要的公开状态。查询失败时不暴露上游错误。 */
export type DesktopRelease =
  | {
      status: "available"
      tag: string
      releaseUrl: string
      checksumsUrl: string | null
      downloads: DesktopDownload[]
    }
  | { status: "unreleased" | "unavailable" }

type UploadedAsset = Record<string, unknown> & { name: string; size: number }

const request = {
  credentials: "omit",
  next: { revalidate: 300 },
} as const

/** 匿名读取最新正式版本，下载地址固定在官方仓库，安装文件按产物命名精确匹配。 */
export async function latestDesktopRelease(fetcher: typeof fetch = fetch): Promise<DesktopRelease> {
  try {
    const response = await fetcher(releaseApi, {
      ...request,
      signal: AbortSignal.timeout(5_000),
    })
    if (response.status === 404) return { status: "unreleased" }
    if (!response.ok) return { status: "unavailable" }
    const payload: unknown = await response.json()
    if (!isRecord(payload) || !Array.isArray(payload.assets)) return { status: "unavailable" }
    const tag = payload.tag_name
    const version = typeof tag === "string" ? /^v(\d+\.\d+\.\d+)$/.exec(tag)?.[1] : undefined
    if (
      payload.draft !== false ||
      payload.prerelease !== false ||
      !version ||
      typeof tag !== "string"
    ) {
      return { status: "unreleased" }
    }
    const assets = payload.assets.filter(isUploaded)
    const checksums = assets.find(({ name }) => name === "SHA256SUMS.txt")
    const assetBase = `${desktopReleasesPage}/download/${tag}`
    const checksumsUrl = checksums ? `${assetBase}/${checksums.name}` : null
    const files = platforms.map(({ platform, architecture, filename }) => ({
      platform,
      architecture,
      file: assets.find(({ name }) => name === filename(version)),
    }))
    const fallback =
      checksums &&
      checksums.size <= 64_000 &&
      checksumsUrl &&
      files.some(({ file }) => file !== undefined && !sha256FromDigest(file.digest))
        ? await readChecksums(fetcher, checksumsUrl)
        : new Map<string, string>()
    return {
      status: "available",
      tag,
      releaseUrl: `${desktopReleasesPage}/tag/${tag}`,
      checksumsUrl,
      downloads: files.map(({ platform, architecture, file }) => {
        const sha256 = file ? (sha256FromDigest(file.digest) ?? fallback.get(file.name)) : undefined
        return {
          platform,
          architecture,
          asset:
            file && sha256
              ? { name: file.name, url: `${assetBase}/${file.name}`, bytes: file.size, sha256 }
              : null,
        }
      }),
    }
  } catch {
    return { status: "unavailable" }
  }
}

async function readChecksums(fetcher: typeof fetch, url: string): Promise<Map<string, string>> {
  const checksums = new Map<string, string>()
  const repeated = new Set<string>()
  try {
    const response = await fetcher(url, { ...request, signal: AbortSignal.timeout(5_000) })
    if (!response.ok) return checksums
    for (const line of (await response.text()).split(/\r?\n/)) {
      const [, hash, name] = /^([\da-f]{64}) [ *]([\w.-]+)$/i.exec(line) ?? []
      if (!hash || !name || repeated.has(name)) continue
      if (checksums.has(name)) {
        repeated.add(name)
        checksums.delete(name)
      } else {
        checksums.set(name, hash.toLowerCase())
      }
    }
  } catch {
    // 附件的 GitHub 摘要仍可使用，缺校验值的平台继续显示状态。
  }
  return checksums
}

function sha256FromDigest(digest: unknown): string | undefined {
  return typeof digest === "string"
    ? /^sha256:([\da-f]{64})$/i.exec(digest)?.[1]?.toLowerCase()
    : undefined
}

function isUploaded(value: unknown): value is UploadedAsset {
  return (
    isRecord(value) &&
    value.state === "uploaded" &&
    typeof value.name === "string" &&
    typeof value.size === "number" &&
    Number.isSafeInteger(value.size) &&
    value.size > 0
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
