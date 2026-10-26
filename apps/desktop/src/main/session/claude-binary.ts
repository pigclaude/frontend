// 负责解析 Claude Code 可执行文件：优先环境变量覆盖，其次是打包后 asar 外的平台二进制，最后是平台包。

import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

/** Claude Code 二进制缺失或不可执行时抛出的错误。 */
export class ClaudeRuntimeUnavailableError extends Error {
  readonly code = "CLAUDE_RUNTIME_UNAVAILABLE"

  constructor(message: string) {
    super(message)
    this.name = "ClaudeRuntimeUnavailableError"
  }
}

/** 二进制解析的可注入参数。 */
export type ClaudeBinaryResolveOptions = {
  env?: Record<string, string | undefined>
  platform?: NodeJS.Platform
  arch?: string
  resourcesPath?: string
  resolvePackage?: (specifier: string) => string
  exists?: (path: string) => boolean
}

/** 解析 Claude Code 可执行文件。保证打包应用不会返回 asar 内的不可执行路径。 */
export function resolveClaudeBinaryPath(options: ClaudeBinaryResolveOptions = {}): string {
  const env = options.env ?? process.env
  const exists = options.exists ?? existsSync
  const override = env.PIGCLAUDE_CLAUDE_BIN?.trim()
  if (override !== undefined && override.length > 0) {
    if (!exists(override)) {
      throw new ClaudeRuntimeUnavailableError(
        `CLAUDE_RUNTIME_UNAVAILABLE: PIGCLAUDE_CLAUDE_BIN does not exist at ${override}`,
      )
    }
    return override
  }

  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const binaryName = platform === "win32" ? "claude.exe" : "claude"
  const resourcesPath = options.resourcesPath ?? readResourcesPath()
  if (resourcesPath !== undefined) {
    for (const candidate of packagedBinaryCandidates(resourcesPath, platform, arch, binaryName)) {
      if (exists(candidate)) return candidate
    }
  }

  const resolvePackage = options.resolvePackage ?? defaultPackageResolver
  try {
    const resolved = resolvePackage(
      `@anthropic-ai/claude-agent-sdk-${platform}-${arch}/${binaryName}`,
    )
    if (exists(resolved) && !isInsideAsar(resolved)) return resolved
  } catch {
    // 平台包可能没有随当前平台安装，继续按缺失处理。
  }
  throw new ClaudeRuntimeUnavailableError(
    `CLAUDE_RUNTIME_UNAVAILABLE: no Claude Code binary for ${platform}-${arch}`,
  )
}

function packagedBinaryCandidates(
  resourcesPath: string,
  platform: NodeJS.Platform,
  arch: string,
  binaryName: string,
): string[] {
  const platformPackage = `claude-agent-sdk-${platform}-${arch}`
  return [
    join(
      resourcesPath,
      "app.asar.unpacked",
      "node_modules",
      "@anthropic-ai",
      platformPackage,
      binaryName,
    ),
    join(resourcesPath, "app.asar.unpacked", "@anthropic-ai", platformPackage, binaryName),
    join(resourcesPath, "claude-agent-sdk", binaryName),
  ]
}

function readResourcesPath(): string | undefined {
  const value = (process as NodeJS.Process & { resourcesPath?: unknown }).resourcesPath
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function isInsideAsar(path: string): boolean {
  return path.includes(".asar") && !path.includes(".asar.unpacked")
}

function defaultPackageResolver(specifier: string): string {
  const anchor = typeof __filename === "string" ? __filename : fileURLToPath(import.meta.url)
  return createRequire(anchor).resolve(specifier)
}
