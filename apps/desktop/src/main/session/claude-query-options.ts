// 负责把会话启动参数换成 SDK query 选项：固定不读用户设置、不落盘，按档位映射思考预算。

import type { CanUseTool, Options, ThinkingConfig } from "@anthropic-ai/claude-agent-sdk"
import { maxSessionRetentionDays } from "../../session-history-contract"
import type { SessionEffort, SessionPermissionMode, SessionThinking } from "./session-events"

/** 开始一次会话的参数；binaryPath 省略时使用 PIGCLAUDE_CLAUDE_BIN 或平台包二进制。 */
export type ClaudeAgentStartOptions = {
  workspace: string
  env: Record<string, string>
  permissionMode: SessionPermissionMode
  canUseTool: CanUseTool
  abortController: AbortController
  binaryPath?: string
  model?: string
  thinking?: SessionThinking
  /** SDK 的 effort 档位；提供时优先于 thinking。 */
  effort?: SessionEffort
  /** 模型支持时启用快速模式。 */
  fast?: boolean
  /** 已保存会话绑定的 id、配置目录和本次是续接还是新建。 */
  persistence?: ClaudePersistenceOptions
  /** 会话专用的宿主工具，未配置时沿用 SDK 自带工具。 */
  mcpServers?: Options["mcpServers"]
}

/** 隔离目录中的 Claude 会话记录设置。 */
export type ClaudePersistenceOptions = {
  sessionId: string
  directory: string
  resume: boolean
}

/** 所有 query 共用的隔离选项。保证不读用户设置、不保存 transcript，环境只用调用方给的 env。 */
export function isolatedQueryOptions(
  cwd: string,
  binaryPath: string,
  env: Record<string, string> | undefined,
): Options {
  return {
    cwd,
    pathToClaudeCodeExecutable: binaryPath,
    env: { ...env },
    settingSources: [],
    persistSession: false,
    includePartialMessages: true,
  }
}

/** 会话 query 的 SDK 选项：在隔离选项上加权限、工具、模型和思考档位。 */
export function buildQueryOptions(
  options: ClaudeAgentStartOptions,
  binaryPath: string,
  spawnClaudeCodeProcess?: Options["spawnClaudeCodeProcess"],
): Options {
  const { persistence } = options
  return {
    ...isolatedQueryOptions(options.workspace, binaryPath, options.env),
    ...(options.mcpServers ? { mcpServers: options.mcpServers } : {}),
    permissionMode: options.permissionMode,
    canUseTool: options.canUseTool,
    abortController: options.abortController,
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.effort !== undefined
      ? { effort: options.effort }
      : options.thinking === undefined
        ? {}
        : { thinking: thinkingConfig(options.thinking) }),
    ...(persistence === undefined
      ? {}
      : {
          persistSession: true,
          ...(persistence.resume
            ? { resume: persistence.sessionId }
            : { sessionId: persistence.sessionId }),
        }),
    ...(persistence === undefined && !options.fast
      ? {}
      : {
          settings: {
            ...(persistence === undefined ? {} : { cleanupPeriodDays: maxSessionRetentionDays }),
            ...(options.fast ? { fastMode: true } : {}),
          },
        }),
    ...(spawnClaudeCodeProcess === undefined ? {} : { spawnClaudeCodeProcess }),
    // 子代理的正文和思考也转发，只读过程视图才看得到它说了什么；不开进度摘要，省号池额度。
    forwardSubagentText: true,
    // CLI 只在带这个开关启动时才接受会话中途切到完全访问。
    allowDangerouslySkipPermissions: true,
  }
}

// 固定档位映射，避免 renderer 直接传任意 token 预算。
function thinkingConfig(thinking: SessionThinking): ThinkingConfig {
  switch (thinking) {
    case "off":
      return { type: "disabled" }
    case "low":
      return { type: "enabled", budgetTokens: 2_048 }
    case "medium":
      return { type: "enabled", budgetTokens: 8_192 }
    case "high":
      return { type: "enabled", budgetTokens: 16_384 }
  }
}
