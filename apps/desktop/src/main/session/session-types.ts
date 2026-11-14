// 定义 SessionHost、PermissionBroker、UsageRecorder 与 preload 共享的会话 IPC 合同。
// 事件只含脱敏内容，不放 access/refresh token、代理密码或 daemon 会话令牌。

import type { MembershipView } from "@pigclaude/contracts/membership"
import type { ClaudeModelsOptions } from "./claude-model-query"
import type { ClaudeAgentStartOptions } from "./claude-query-options"
import type { PermissionAnswer, PermissionRequestEvent } from "./permission-broker"
import type { SessionEnvelope } from "./session-envelope"
import type { SessionEnvironmentInput } from "./session-environment"
import type {
  ClaudeModel,
  SessionEffort,
  SessionEvent,
  SessionPermissionMode,
  SessionThinking,
} from "./session-events"
import type { UsageRange, UsageRecord, UsageSummary } from "./usage-recorder"
import type { ProfileEnvironment } from "./profile-environment"

/** session.start 的输入；工作区必须是绝对目录，其余字段由 main 侧校验。 */
export type SessionStartInput = {
  workspace: string
  model?: string
  thinking?: SessionThinking
  /** 新输入区按模型提供的 effort；和 thinking 二选一，effort 优先。 */
  effort?: SessionEffort
  /** 模型支持时启用快速模式；只在会话启动时生效。 */
  fast?: boolean
  permissionMode: SessionPermissionMode
  accountId?: string
}

/** session.send 的输入；附件当前只做形状校验，不由适配器传递。 */
export type SessionSendInput = {
  text: string
  attachments?: string[]
}

/** 会话命令指向的会话；id 是 session.start 返回的 PigClaude 会话 id。 */
export type SessionTarget = { sessionId: string }

/** 按序号补拉事件的输入：读出序号大于 afterSeq 的要保存的事件。 */
export type SessionEventsInput = SessionTarget & { afterSeq: number }

/** session.status 返回的脱敏会话快照。 */
export type SessionStatusView = {
  active: boolean
  sessionId: string | null
  model: string | null
  permissionMode: SessionPermissionMode
  accountId: string | null
  pendingPermissions: number
  turnId: string | null
}

/** session.models 的结果：models 一定非空。cliError 不为 null 时 Claude Code 没有列出模型，models 是内置兜底目录。 */
export type SessionModelCatalog = { models: ClaudeModel[]; cliError: string | null }

/** 账号或系统提供的时区和 locale；用于会话环境和 Intl 预加载。 */
export type SessionProfile = ProfileEnvironment

/** 换号原因，与 LocalRuntime 一致。 */
export type SessionAccountSwitchReason = "initial" | "switch" | "quota"

/** session.account-switched 事件；只含账号 id 和原因。 */
export type SessionAccountSwitchedEvent = {
  type: "account-switched"
  from: string | null
  to: string
  reason: SessionAccountSwitchReason
}

/** 给用户的一次性提示，例如自动审批不可用的原因；界面用通知展示，不进对话记录。 */
export type SessionNoticeEvent = { type: "notice"; message: string }

/** SessionHost 发给 preload 的全部事件：适配器事件加权限、换号和提示。 */
export type SessionHostEvent =
  SessionEvent | PermissionRequestEvent | SessionAccountSwitchedEvent | SessionNoticeEvent

/** 设计第 12 节的稳定错误码；SESSION_START_FAILED 来自第 13 节的配置目录失败分支。 */
export type SessionErrorCode =
  | "MEMBERSHIP_REQUIRED"
  | "WORKSPACE_UNAVAILABLE"
  | "NO_AVAILABLE_ACCOUNT"
  | "ACCOUNT_ENVIRONMENT_MISMATCH"
  | "CLAUDE_RUNTIME_UNAVAILABLE"
  | "DAEMON_UNAVAILABLE"
  | "PROXY_UNAVAILABLE"
  | "NETWORK_UNAVAILABLE"
  | "AUTH_EXPIRED"
  | "PERMISSION_TIMEOUT"
  | "SESSION_ALREADY_ACTIVE"
  | "SESSION_CANCELLED"
  | "SESSION_NOT_FOUND"
  | "SDK_ERROR"
  | "SESSION_START_FAILED"

/** 带稳定错误码的会话错误；message 可直接映射到界面文案。 */
export class SessionHostError extends Error {
  readonly code: SessionErrorCode

  /** 创建带错误码的会话错误，消息里附带错误码便于 IPC 传递。 */
  constructor(code: SessionErrorCode, message: string) {
    super(`${code}: ${message}`)
    this.name = "SessionHostError"
    this.code = code
  }
}

/** SessionHost 需要的会员端口；启动前必须实时 inspect 一次。 */
export type SessionMembership = {
  view(): MembershipView
  inspect(): Promise<MembershipView>
  subscribe(listener: (view: MembershipView) => void): () => void
}

/** LocalRuntime 暴露给会话层的换号事件。 */
export type SessionRuntimeEvent = {
  type: "account-switched"
  from: string | null
  to: string
  reason: SessionAccountSwitchReason
}

/** SessionHost 需要的 runtime 端口；不暴露凭据或代理地址。 */
export type SessionRuntime = {
  readonly daemonBaseUrl: string | null
  readonly sessionToken: string
  subscribe(listener: (event: SessionRuntimeEvent) => void): () => void
  setPreferredAccount?(accountId: string | null): void
  /** 开始新会话前重置上一个会话的账号跟踪，保证首次选号广播 initial。 */
  beginSession?(): void
  /** CLI 启动前固定环境，返回清理后使用的释放操作。 */
  bindEnvironment?: (profile: SessionProfile) => (() => void) | Promise<() => void>
  /** 不刷新凭据地判断是否有可授权账号；启动前置条件。 */
  hasAvailableAccount(): Promise<boolean>
}

/** 一次会话的环境摘要；真实实现是 SessionEnvironment，测试可注入假实现。 */
export type SessionEnvironmentPort = {
  readonly env: Record<string, string>
  readonly configDir: string
  readonly sessionDir: string
  readonly workspace: string
  readonly binaryPath: string
  readonly timezone: string
  cleanup(): Promise<void>
}

/** 创建会话环境的工厂；输入与 SessionEnvironment.create 一致。 */
export type SessionEnvironmentFactory = (
  input: SessionEnvironmentInput,
) => Promise<SessionEnvironmentPort>

/** 会话适配器端口；真实实现是 ClaudeAgentAdapter。 */
export type SessionAdapterPort = {
  start(options: ClaudeAgentStartOptions): Promise<void>
  send(text: string): Promise<void>
  interrupt(): Promise<void>
  stop(): Promise<void>
  models(options?: ClaudeModelsOptions): Promise<ClaudeModel[]>
  setPermissionMode(mode: SessionPermissionMode): Promise<void>
  setModel(model: string): Promise<void>
}

/** 适配器工厂；onEvent 由 SessionHost 提供并负责转发。 */
export type SessionAdapterFactory = (onEvent: (event: SessionEvent) => void) => SessionAdapterPort

/** 用量记录器端口；真实实现是 UsageRecorder。 */
export type SessionUsagePort = {
  record(record: UsageRecord): Promise<void>
  summary(range: UsageRange): Promise<UsageSummary>
  onWriteFailed(listener: (message: string) => void): () => void
}

/** preload 暴露给 renderer 的 session 命名空间；会话命令都带会话 id，事件都包在信封里。 */
export type SessionBridge = {
  start: (input: SessionStartInput) => Promise<{ sessionId: string }>
  send: (input: SessionTarget & SessionSendInput) => Promise<void>
  cancel: (input: SessionTarget) => Promise<void>
  respondPermission: (input: SessionTarget & PermissionAnswer) => Promise<void>
  setMode: (input: SessionTarget & { mode: SessionPermissionMode }) => Promise<void>
  setModel: (input: SessionTarget & { model: string }) => Promise<void>
  stop: (input: SessionTarget) => Promise<void>
  /** 按序号补拉要保存的事件；渲染层发现断号时调用。 */
  events: (input: SessionEventsInput) => Promise<SessionEnvelope[]>
  models: () => Promise<SessionModelCatalog>
  status: () => Promise<SessionStatusView>
  subscribe: (listener: (envelope: SessionEnvelope) => void) => () => void
}

/** preload 暴露的只读用量命名空间。 */
export type UsageBridge = {
  summary: (input: { range: UsageRange }) => Promise<UsageSummary>
}

export type {
  ClaudeModel,
  PermissionAnswer,
  PermissionRequestEvent,
  SessionEffort,
  SessionEnvelope,
  SessionEvent,
  SessionPermissionMode,
  SessionThinking,
  UsageRange,
  UsageSummary,
}
