// 有界下载固定提交或带摘要的 HTTPS 归档，摘要与解包使用同一份实际响应字节。

import type { PluginMarketplaceSourceInput } from "../../plugin-marketplace-contract"
import { readPluginArchiveBytes } from "./plugin-archive"
import { PluginArchiveError, pluginArchiveLimits } from "./plugin-archive-entries"
import { normalizeMarketplaceHttpsUrl } from "./plugin-marketplace-source-input"

type RemoteSource = Exclude<PluginMarketplaceSourceInput, { kind: "directory" }>
const downloadTimeoutMs = 20_000
const maximumRedirects = 5
const redirects = new Set([301, 302, 303, 307, 308])

/** 读取固定提交或验证归档摘要；GitHub 来源凭据始终绑定到 codeload。 */
export async function loadMarketplaceArchive(
  source: RemoteSource,
  fetcher: typeof fetch,
  entryDigest: string | null = null,
): Promise<{ files: ReadonlyMap<string, Buffer>; sha256: string }> {
  if (source.kind === "https" && entryDigest !== null && entryDigest !== source.sha256)
    throw unavailable()
  const expected = source.kind === "https" ? source.sha256 : entryDigest
  const url =
    source.kind === "github"
      ? `https://codeload.github.com/${source.repo}/tar.gz/${source.commit}`
      : source.url
  const bytes = await downloadMarketplaceBytes(url, fetcher, {
    byteLimit: pluginArchiveLimits.inputBytes,
    allowHttpsRedirects: source.kind === "https",
  })
  return readPluginArchiveBytes(bytes, expected)
}

/** 有界读取 HTTPS 响应，可由普通归档来源选择是否接受 HTTPS 跳转。 */
export async function downloadMarketplaceBytes(
  initial: string,
  fetcher: typeof fetch,
  { byteLimit, allowHttpsRedirects }: { byteLimit: number; allowHttpsRedirects?: boolean },
): Promise<Buffer> {
  const signal = AbortSignal.timeout(downloadTimeoutMs)
  try {
    let url = normalizeMarketplaceHttpsUrl(initial)
    for (let hop = 0; hop <= maximumRedirects; hop += 1) {
      const response = await fetcher(url, {
        redirect: "manual",
        credentials: "omit",
        signal,
      })
      if (allowHttpsRedirects && redirects.has(response.status) && !response.redirected) {
        const location = response.headers.get("location")
        await closeResponse(response)
        if (location === null || hop === maximumRedirects) throw unavailable()
        url = normalizeMarketplaceHttpsUrl(new URL(location, url).href)
        continue
      }
      if (!response.ok || response.status === 206 || response.redirected) {
        await closeResponse(response)
        throw unavailable()
      }
      return await responseBytes(response, byteLimit)
    }
  } catch (error) {
    if (error instanceof PluginArchiveError) throw error
    throw unavailable()
  }
  throw unavailable()
}

async function responseBytes(response: Response, limit: number): Promise<Buffer> {
  if (Number(response.headers.get("content-length")) > limit) {
    await closeResponse(response)
    throw new PluginArchiveError("PLUGIN_ARCHIVE_TOO_LARGE")
  }
  if (!response.body) throw unavailable()
  const reader = response.body.getReader()
  const parts: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return Buffer.concat(parts, total)
      total += value.byteLength
      if (total > limit) throw new PluginArchiveError("PLUGIN_ARCHIVE_TOO_LARGE")
      parts.push(Buffer.from(value))
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

async function closeResponse(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

function unavailable(): Error {
  return new Error("PLUGIN_MARKETPLACE_SOURCE_UNAVAILABLE")
}
