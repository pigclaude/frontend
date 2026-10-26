// 负责统一解析 Claude CLI 配置目录，供 Keychain 读取和元数据读取共用。

/** 配置目录解析输入。显式 configDir 优先于 CLAUDE_CONFIG_DIR，null 表示强制默认目录。 */
export type ClaudeCliConfigDirInput = {
  configDir?: string | null
  env?: NodeJS.ProcessEnv
}

/** 返回配置目录原文；未设置或只有空白时返回 null。保证两个读取模块的路径语义一致。 */
export function resolveClaudeCliConfigDir(input: ClaudeCliConfigDirInput): string | null {
  const env = input.env ?? process.env
  const value = input.configDir !== undefined ? input.configDir : env.CLAUDE_CONFIG_DIR
  if (value === undefined || value === null || value.trim() === "") return null
  return value
}
