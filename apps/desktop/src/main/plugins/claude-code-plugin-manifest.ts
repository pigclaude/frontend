// 解析 Claude Code 插件清单，只抽取提示组件及待披露的忽略项。

import { posix } from "node:path"
import { z } from "zod"
import type { ClaudeCodePluginIgnoredComponent } from "../../capability-plugin-contract"
import { isCapabilityPluginId } from "./capability-plugin-paths"

/** Claude Code 在插件根使用的清单位置。 */
export const claudeCodePluginManifestFile = ".claude-plugin/plugin.json"
const manifestLimit = 256 * 1024
const decoder = new TextDecoder("utf-8", { fatal: true })
const paths = z.union([z.string(), z.array(z.string())])
const command = z
  .object({
    source: z.string().optional(),
    content: z.string().optional(),
    description: z.string().optional(),
    argumentHint: z.string().optional(),
    model: z.string().optional(),
    allowedTools: z.array(z.string()).optional(),
  })
  .refine(({ source, content }) => (source === undefined) !== (content === undefined))
const manifest = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  description: z.string().optional(),
  commands: z.union([paths, z.record(z.string(), command)]).optional(),
  skills: paths.optional(),
  agents: paths.optional(),
})

/** 命名命令的宿主允许字段，生成清单时只使用此结构。 */
export type ClaudeCodeCommand = z.infer<typeof command>

/** 源清单中允许复制的字段及原包禁止加载的类别与文件路径。 */
export type ClaudeCodePluginSource = {
  name: string
  version: string
  description?: string | undefined
  commands?: string | string[] | Record<string, ClaudeCodeCommand> | undefined
  skills?: string | string[] | undefined
  agents?: string | string[] | undefined
  ignoredComponents: ClaudeCodePluginIgnoredComponent[]
  ignoredPaths: ReadonlySet<string>
}

/** 解析普通清单数据，不调用来源的执行字段；无清单时按约使用本机提供的标识。 */
export function readClaudeCodePluginManifest(
  files: ReadonlyMap<string, Buffer>,
  fallbackId: string,
): ClaudeCodePluginSource {
  const bytes = files.get(claudeCodePluginManifestFile)
  if (bytes !== undefined && bytes.length > manifestLimit)
    throw new Error("PLUGIN_BUNDLE_TOO_LARGE")
  try {
    const raw = z
      .record(z.string(), z.unknown())
      .parse(bytes === undefined ? {} : (JSON.parse(decoder.decode(bytes)) as unknown))
    const parsed = manifest.parse(raw)
    const name = parsed.name ?? fallbackId
    if (!isCapabilityPluginId(name)) throw new Error()
    const ignoredComponents: ClaudeCodePluginIgnoredComponent[] = []
    const ignoredPaths = new Set<string>()
    const filenames = [...files.keys()]
    const names = new Set(filenames.map((path) => posix.basename(path.toLowerCase())))
    const ignored = [
      { field: "hooks", component: "hooks", found: filenames.some(isPluginHookFile) },
      { field: "mcpServers", component: "mcp", found: names.has(".mcp.json") },
      { field: "lspServers", component: "lsp", found: names.has(".lsp.json") },
    ] as const
    for (const { field, component, found } of ignored) {
      if (found || Object.hasOwn(raw, field)) ignoredComponents.push(component)
      const item = raw[field]
      for (const value of Array.isArray(item) ? item : [item]) {
        if (typeof value === "string" && value.startsWith("./"))
          ignoredPaths.add(value.slice(2).normalize("NFC").toLowerCase())
      }
    }
    return {
      ...parsed,
      name,
      version: parsed.version ?? "0.0.0",
      ignoredComponents,
      ignoredPaths,
    }
  } catch {
    throw new Error("PLUGIN_MANIFEST_INVALID")
  }
}

/** 判断根 hook 目录和标准 hook 配置文件是否属于禁止加载的插件组件。 */
export function isPluginHookFile(path: string): boolean {
  const normalized = path.toLowerCase()
  return normalized.startsWith("hooks/") || normalized.endsWith("/hooks/hooks.json")
}
