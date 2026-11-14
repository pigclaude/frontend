// 定义会话适配器向上层广播的事件类型；只含脱敏内容，不带 token、代理地址或完整环境变量。

import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk"
import type { BackgroundTaskSignal } from "./background-tasks"
import type { TaskSignal } from "./task-signals"

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

/**
 * 子代理归属：产生事件的子代理是哪一次 Agent 工具调用派生的（父工具调用 id），以及它的 agent id
 * （即它的任务 id）。两者至少知道一个：子代理的消息总带父工具调用 id；权限询问只带 agent id，
 * 主进程认不出这个 agent id 时父工具调用 id 为 null。事件上主线程的归属是 null。
 */
export type SubagentRef =
  { parentToolUseId: string; agentId: string | null } | { parentToolUseId: null; agentId: string }

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
      /** 子代理归属；主线程为 null。 */
      subagent: SubagentRef | null
      blocks: SessionContentBlock[]
      /** 主线程的思考消息才有：从这一段思考的第一个增量到这条消息的毫秒数，由主进程计时。 */
      thinkingMs?: number
    }
  | {
      type: "tool-result"
      toolUseId: string
      content: string
      isError: boolean
      /** 子代理归属；主线程为 null。 */
      subagent: SubagentRef | null
      /** 工具只是在后台启动了任务（例如后台子代理）；这时的结果不是任务交回的结果。 */
      backgroundLaunch?: true
    }
  | {
      type: "result"
      subtype: string
      isError: boolean
      durationMs: number
      numTurns: number
      stopReason: string | null
      /** 这一个 result 的主线程用量，不含子代理。 */
      usage: SessionUsage
      /** 会话到这里为止的累计用量，含子代理和工作流，各模型相加；CLI 没给时省略。 */
      totalUsage?: SessionUsage
    }
  | { type: "error"; code: string; message: string }
  | { type: "ended"; reason: "completed" | "stopped" | "error" }

/** 上下文压缩完成的信号；只在主进程内部使用，不发给渲染层。 */
export type ContextCompactedSignal = { type: "context-compacted" }

/** 适配器交给会话的全部输入：会话事件，以及只在主进程使用的后台任务、任务进度和上下文压缩信号。 */
export type AdapterEvent =
  SessionEvent | BackgroundTaskSignal | TaskSignal | ContextCompactedSignal

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
