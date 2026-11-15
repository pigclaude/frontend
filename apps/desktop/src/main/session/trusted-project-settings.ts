// 在可信项目的原生配置之上固定 PigClaude 的会话转发和认证设置。

import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import JSON5 from "json5"
import type { Options } from "@anthropic-ai/claude-agent-sdk"
import {
  canonicalProjectPath,
  containsProjectPath,
  type ProjectConfigurationScope,
} from "./project-configuration-scope"

/** 只记录拼写和插件名称，不把项目环境变量的值交给 flag 设置。 */
export type TrustedProjectSettings = { envNames: string[]; pluginNames: string[] }

const fixedNames = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_PROJECT_DIR_NAME",
  "CLAUDE_CODE_TMPDIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy",
  "TZ",
  "LANG",
  "LC_ALL",
] as const

const cloudSwitches = [
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
] as const

/** 检查 CLI 会读取的项目配置只来自项目范围，并收集需要屏蔽的原始键名。 */
export async function inspectTrustedSettings(
  scope: ProjectConfigurationScope,
): Promise<TrustedProjectSettings> {
  const root = scope.directories.at(-1)
  const envNames = new Set<string>()
  const pluginNames = new Set<string>()
  if (root === undefined) return { envNames: [], pluginNames: [] }
  const inProject = async (candidate: string): Promise<string | null> => {
    const path = await canonicalProjectPath(candidate)
    if (
      path !== null &&
      (!containsProjectPath(root, path) || containsProjectPath(scope.personalDirectory, path))
    )
      throw new Error("项目设置指向项目范围之外")
    return path
  }

  for (const directory of scope.directories) {
    await inProject(join(directory, ".claude"))
    await inProject(join(directory, ".mcp.json"))
    for (const file of ["settings.json", "settings.local.json"]) {
      const resolved = await inProject(join(directory, ".claude", file))
      if (resolved === null) continue
      const info = await stat(resolved)
      if (!info.isFile() || info.size > 512 * 1024) throw new Error("项目设置文件不可读")
      const settings = await readSettings(resolved)
      if (settings === null) continue
      if (record(settings.env)) for (const key of Object.keys(settings.env)) envNames.add(key)
      if (record(settings.enabledPlugins))
        for (const key of Object.keys(settings.enabledPlugins)) pluginNames.add(key)
    }
  }
  return { envNames: [...envNames], pluginNames: [...pluginNames] }
}

/** 生成高于 project/local 文件的 flag 设置；常规项目环境变量与 hooks 保留由 CLI 处理。 */
export function trustedFlagSettings(
  env: Readonly<Record<string, string>>,
  project: TrustedProjectSettings,
): Exclude<Options["settings"], string | undefined> {
  const fixed = new Map<string, string>(fixedNames.map((key) => [key, env[key] ?? ""]))
  fixed.set("ANTHROPIC_API_KEY", "")
  for (const key of cloudSwitches) fixed.set(key, "0")
  for (const key of project.envNames) {
    const upper = key.toUpperCase()
    const value = fixed.get(upper)
    if (value !== undefined) fixed.set(key, value)
    else if (/^ANTHROPIC_.*(?:BASE_URL|API_KEY|AUTH_TOKEN|CUSTOM_HEADERS)$/.test(upper))
      fixed.set(key, "")
  }
  return {
    env: Object.fromEntries(fixed),
    apiKeyHelper: "",
    proxyAuthHelper: "",
    ...(project.pluginNames.length === 0
      ? {}
      : { enabledPlugins: Object.fromEntries(project.pluginNames.map((id) => [id, false])) }),
  }
}

async function readSettings(path: string): Promise<Record<string, unknown> | null> {
  const text = await readFile(path, "utf8")
  try {
    const value: unknown = JSON5.parse(text)
    return record(value) ? value : null
  } catch {
    return null
  }
}

function record(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input)
}
