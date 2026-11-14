// 负责 macOS 的手动替换更新：读取 macOS 更新清单，按芯片挑出 DMG，下载到本机并用清单里的 sha512 校验。
import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdir, rename, rm } from "node:fs/promises"
import { basename, join } from "node:path"
import { pipeline } from "node:stream/promises"
import type { LatestRelease } from "./update-release"

/** macOS 更新清单在发布里的文件名。 */
export const MAC_MANIFEST = "latest-mac.yml"

/** 要下载的 DMG：下载地址和清单里登记的 sha512（base64）与大小。 */
export type MacPackage = {
  name: string
  url: string
  sha512: string
  size: number
}

type ManifestFile = { url: string; sha512: string | null; size: number | null }

/** 读出 electron-builder 更新清单里的版本和文件列表；只认这几项。 */
export function parseUpdateManifest(text: string): {
  version: string | null
  files: ManifestFile[]
} {
  let version: string | null = null
  const files: ManifestFile[] = []
  let current: ManifestFile | null = null
  for (const line of text.split(/\r?\n/)) {
    const top = /^version:\s*'?([^'\s]+)'?\s*$/.exec(line)
    if (top) {
      version = top[1] ?? null
      current = null
      continue
    }
    const entry = /^\s*-\s+url:\s*(.+)$/.exec(line)
    if (entry) {
      current = { url: (entry[1] ?? "").trim(), sha512: null, size: null }
      files.push(current)
      continue
    }
    const field = /^\s+(sha512|size):\s*(.+)$/.exec(line)
    if (field && current) {
      const value = (field[2] ?? "").trim()
      if (field[1] === "size") current.size = Number(value)
      else current.sha512 = value
    }
  }
  return { version, files }
}

/**
 * 从清单和发布附件里挑出这个芯片的 DMG。清单版本必须和发布版本一致，
 * DMG 必须同时出现在清单（带 sha512 和大小）和附件里；挑不到时返回 null，由调用方改为打开发布页。
 */
export function pickMacPackage(
  manifest: string,
  release: LatestRelease,
  arch: string,
): MacPackage | null {
  const parsed = parseUpdateManifest(manifest)
  if (parsed.version !== release.version) return null
  const file = parsed.files.find((item) => item.url.endsWith(`-${arch}.dmg`))
  if (!file?.sha512 || !file.size || basename(file.url) !== file.url) return null
  const asset = release.assets.find((item) => item.name === file.url)
  if (!asset) return null
  return { name: file.url, url: asset.url, sha512: file.sha512, size: file.size }
}

/**
 * 下载 DMG 到 directory。边写边算 sha512，大小和 sha512 都与清单一致才改成正式文件名并返回路径；
 * 不一致、HTTP 失败或中断时删掉写了一半的文件并抛出。
 */
export async function downloadVerifiedPackage(
  pkg: MacPackage,
  directory: string,
  fetchImpl: typeof fetch,
  onProgress?: (percent: number) => void,
): Promise<string> {
  await mkdir(directory, { recursive: true })
  const target = join(directory, pkg.name)
  const partial = `${target}.part`
  try {
    const response = await fetchImpl(pkg.url, { headers: { accept: "application/octet-stream" } })
    if (!response.ok || !response.body) {
      throw new Error(`update download failed: HTTP ${response.status}`)
    }
    const hash = createHash("sha512")
    let received = 0
    await pipeline(
      response.body as unknown as AsyncIterable<Uint8Array>,
      async function* (source: AsyncIterable<Uint8Array>) {
        for await (const chunk of source) {
          hash.update(chunk)
          received += chunk.length
          onProgress?.(Math.min(100, (received / pkg.size) * 100))
          yield chunk
        }
      },
      createWriteStream(partial),
    )
    if (received !== pkg.size) throw new Error("update download failed: size mismatch")
    if (hash.digest("base64") !== pkg.sha512) {
      throw new Error("update download failed: sha512 mismatch")
    }
    await rename(partial, target)
    return target
  } catch (error: unknown) {
    await rm(partial, { force: true })
    throw error
  }
}

/** 清掉之前下载的安装包；启动时调一次，避免用户数据目录越攒越大。 */
export async function clearDownloads(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true })
}
