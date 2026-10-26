// 定义会话适配器向上层广播的事件类型；只含脱敏内容，不带 token、代理地址或完整环境变量。

import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk"

/** 应用允许的四档权限模式；与设计第 9.1 节一致。 */
export type SessionPermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions"

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

/** 界面用的模型信息；SDK 没有默认标记，isDefault 目前由会话 init 模型另行判断。 */
export type ClaudeModel = {
  id: string
  displayName: string
  description: string
  isDefault: boolean
}
