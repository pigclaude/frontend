// 按市场类型规范化来源，只检查标识、HTTPS 地址和本机路径的形状。

import { isAbsolute, resolve } from "node:path"
import type { PluginMarketplaceSourceInput } from "../../plugin-marketplace-contract"
import { PluginArchiveEntries } from "./plugin-archive-entries"

const repoOwner = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i
const repoName = /^[a-z0-9_.-]{1,100}$/i
const fullCommit = /^[0-9a-f]{40}$/i
const sha256 = /^[0-9a-f]{64}$/i
const unavailableDirectories = new Set([".git", "node_modules"])

/** 只接收固定提交、带 SHA-256 的 HTTPS 归档或者本机绝对目录。 */
export function normalizePluginMarketplaceSource(input: unknown): PluginMarketplaceSourceInput {
  const value = marketplaceRecord(input)
  if (value?.kind === "github") {
    const parts = typeof value.repo === "string" ? value.repo.split("/") : []
    const [owner, repo] = parts
    if (
      parts.length !== 2 ||
      !owner ||
      !repo ||
      !repoOwner.test(owner) ||
      !repoName.test(repo) ||
      repo === "." ||
      repo === ".." ||
      typeof value.commit !== "string" ||
      !fullCommit.test(value.commit)
    )
      throw invalidSource()
    return {
      kind: "github",
      repo: (owner + "/" + repo).toLowerCase(),
      commit: value.commit.toLowerCase(),
    }
  }
  if (value?.kind === "https")
    return {
      kind: "https",
      url: normalizeMarketplaceHttpsUrl(value.url),
      sha256: normalizeMarketplaceChecksum(value.sha256),
    }
  if (
    value?.kind === "directory" &&
    typeof value.path === "string" &&
    value.path.length <= 4096 &&
    !value.path.includes("\0") &&
    isAbsolute(value.path)
  )
    return { kind: "directory", path: resolve(value.path) }
  throw invalidSource()
}

/** 校验下载和跳转地址，不允许嵌入认证或片段。 */
export function normalizeMarketplaceHttpsUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096 || /[\x00-\x20\x7f\\#]/.test(value))
    throw invalidSource()
  try {
    const url = new URL(value)
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.href.length > 4096
    )
      throw invalidSource()
    return url.href
  } catch {
    throw invalidSource()
  }
}

/** SHA-256 是独立于 GitHub 提交标识的 64 位十六进制字符串。 */
export function normalizeMarketplaceChecksum(value: unknown): string {
  if (typeof value !== "string" || !sha256.test(value)) throw invalidSource()
  return value.toLowerCase()
}

/** 保留相对于目录根的 ./ 路径，拒绝路径别名和不可移植的名称。 */
export function normalizeMarketplaceRelativePath(value: unknown): string {
  if (value === "." || value === "./") return "./"
  if (typeof value !== "string" || !value.startsWith("./") || value.includes("\\"))
    throw invalidSource()
  const path = value.slice(2).replace(/\/$/, "").normalize("NFC")
  if (
    path
      .split("/")
      .some(
        (part) =>
          !part || part === "." || part === ".." || unavailableDirectories.has(part.toLowerCase()),
      )
  )
    throw invalidSource()
  try {
    new PluginArchiveEntries().reserve(path, true, 0)
  } catch {
    throw invalidSource()
  }
  return "./" + path
}

/** 为 marketplace 的未知 JSON 和 IPC 值取对象。 */
export function marketplaceRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function invalidSource(): Error {
  return new Error("PLUGIN_MARKETPLACE_SOURCE_INVALID")
}
