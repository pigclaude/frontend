// 按包根的格式选择读取器和安装校验，披露前取得独立的文件快照。

import { createHash } from "node:crypto"
import { lstat } from "node:fs/promises"
import { basename, isAbsolute, join } from "node:path"
import {
  capabilityPluginManifestFile,
  type CapabilityPluginInstallSource,
} from "../../capability-plugin-contract"
import {
  readCapabilityPluginDirectory,
  validateCapabilityPluginBundle,
  type CapabilityPluginBundle,
} from "./capability-plugin-bundle"
import {
  readClaudeCodePluginDirectory,
  synthesizeClaudeCodePlugin,
  type ClaudeCodePluginBundle,
} from "./claude-code-plugin-bundle"

/** 已验证、无需再次访问原始目录或归档的两种安装副本。 */
export type DesktopPluginBundle =
  | ({ type: "capability" } & CapabilityPluginBundle)
  | ({ type: "claude-code" } & ClaudeCodePluginBundle)

/** 能力清单存在时沿用原有模块筛选；其他目录按 Claude Code 包格式处理。 */
export async function readDesktopPluginDirectory(
  path: string,
): Promise<ReadonlyMap<string, Buffer>> {
  const capability = await lstat(join(path, capabilityPluginManifestFile)).then(
    () => true,
    (error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
      throw new Error("PLUGIN_SOURCE_INVALID")
    },
  )
  return capability ? readCapabilityPluginDirectory(path) : readClaudeCodePluginDirectory(path)
}

/** 从同一份正文选择插件格式，校验能力入口或合成 Claude Code 的允许组件。 */
export function validateDesktopPluginBundle(
  files: ReadonlyMap<string, Buffer>,
  appVersion: string,
  fallbackId: string,
): DesktopPluginBundle {
  return files.has(capabilityPluginManifestFile)
    ? { type: "capability", ...validateCapabilityPluginBundle(files, appVersion) }
    : { type: "claude-code", ...synthesizeClaudeCodePlugin(files, fallbackId) }
}

/** 保留本机选择的来源限制，取得用于披露的真实包和原归档摘要。 */
export async function loadLocalDesktopPlugin(
  source: CapabilityPluginInstallSource,
  appVersion: string,
  readArchive: (path: string, sha256: string) => Promise<ReadonlyMap<string, Buffer>>,
): Promise<{ bundle: DesktopPluginBundle; sha256: string | null }> {
  if (!isAbsolute(source.path) || source.path.includes("\0"))
    throw new Error("PLUGIN_SOURCE_INVALID")
  if (source.kind === "archive" && typeof source.sha256 !== "string")
    throw new Error("PLUGIN_ARCHIVE_SHA256_INVALID")
  const sha256 = source.kind === "archive" ? source.sha256.toLowerCase() : null
  if (sha256 !== null && !/^[0-9a-f]{64}$/.test(sha256))
    throw new Error("PLUGIN_ARCHIVE_SHA256_INVALID")
  const files =
    sha256 === null
      ? await readDesktopPluginDirectory(source.path)
      : await readArchive(source.path, sha256)
  const sourceName = basename(source.path)
  const fallbackId =
    sha256 === null ? sourceName : sourceName.replace(/\.(?:tar\.gz|tgz|zip)$/i, "")
  return { bundle: validateDesktopPluginBundle(files, appVersion, fallbackId), sha256 }
}

/** 对按路径排序的已校验文件名、长度和原始正文绑定摘要。 */
export function pluginBundleFilesDigest(files: ReadonlyMap<string, Buffer>): string {
  const digest = createHash("sha256")
  for (const path of [...files.keys()].sort()) {
    const content = files.get(path)
    if (content === undefined) throw new Error("PLUGIN_BUNDLE_INVALID")
    digest.update(JSON.stringify([path, content.length]))
    digest.update(content)
  }
  return digest.digest("hex")
}
