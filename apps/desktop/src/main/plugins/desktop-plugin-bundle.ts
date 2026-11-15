// 按包根的格式选择读取器和安装校验，披露前取得独立的文件快照。

import { lstat } from "node:fs/promises"
import { join } from "node:path"
import { capabilityPluginManifestFile } from "../../capability-plugin-contract"
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
