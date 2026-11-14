// 定义会话适配器向上层广播的事件类型；只含脱敏内容，不带 token、代理地址或完整环境变量。

import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk"

/** 应用允许的权限模式：四个档位加计划。 */
export type SessionPermissionMode =
  "default" | "acceptEdits" | "auto" | "plan" | "bypassPermissions"

/** 应用允许的四档思考深度；off 关闭，其余映射到固定 token 预算。 */
export type SessionThinking = "off" | "low" | "medium" | "high"

/** SDK 的 effort 档位；xhigh/max 只在模型支持时由输入区提供。 */
export type SessionEffort = "low" | "medium" | "high" | "xhigh" | "max"

/** 应用事件里的内容块；工具输入保持 unknown，避免把 SDK 内部类型泄漏到界面。 */
export type SessionContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool-use"; id: string; name: string; input: unknown }

/** 一次 result 的用量元数据；只有数字，不含提示词或回复正文。 */
export type SessionUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

/** 适配器向 SessionHost 广播的事件。 */
export type SessionEvent =
  | {
      type: "started"
      sessionId: string
      model: string
      tools: string[]
      permissionMode: PermissionMode
    }
  /** Claude Code 报告的当前权限模式；它自己改模式时也会发。 */
  | { type: "mode"; permissionMode: PermissionMode }
  | { type: "delta"; text: string; thinking: boolean; blockIndex: number }
  | {
      type: "message"
      messageId: string
      model: string
      parentToolUseId: string | null
      blocks: SessionContentBlock[]
    }
  | { type: "tool-result"; toolUseId: string; content: string; isError: boolean }
  | {
      type: "result"
      subtype: string
      isError: boolean
      durationMs: number
      numTurns: number
      stopReason: string | null
      usage: SessionUsage
    }
  | { type: "error"; code: string; message: string }
  | { type: "ended"; reason: "completed" | "stopped" | "error" }

/** 界面用的模型信息；第一行是 CLI 的默认选择。 */
export type ClaudeModel = {
  id: string
  /** SDK 别名解析到的规范模型 id；旧数据没有。 */
  resolvedModel?: string
  displayName: string
  description: string
  isDefault: boolean
  /** 模型支持的思考档位；没有可调档位时为空。 */
  efforts?: readonly string[]
  /** 是否支持快速模式。 */
  fast?: boolean
}
