// 定义 SessionHost、PermissionBroker、UsageRecorder 与 preload 共享的会话 IPC 合同。
// 事件只含脱敏内容，不放 access/refresh token、代理密码或 daemon 会话令牌。

import type { MembershipView } from "@pigclaude/contracts/membership"
import type { ClaudeAgentStartOptions, ClaudeModelsOptions } from "./claude-agent-adapter"
import type { PermissionAnswer, PermissionRequestEvent } from "./permission-broker"
import type { SessionEnvironmentInput } from "./session-environment"
import type {
  ClaudeModel,
  SessionEvent,
  SessionPermissionMode,
  SessionThinking,
} from "./session-events"
import type { UsageRange, UsageRecord, UsageSummary } from "./usage-recorder"

/** session.start 的输入；工作区必须是绝对目录，其余字段由 main 侧校验。 */
export type SessionStartInput = {
  workspace: string
  model?: string
  thinking?: SessionThinking
  permissionMode: SessionPermissionMode
  accountId?: string
}

/** session.send 的输入；附件当前只做形状校验，不由适配器传递。 */
export type SessionSendInput = {
  text: string
  attachments?: string[]
}

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

/** 账号或系统提供的时区和 locale；用于会话环境和 Intl 预加载。 */
export type SessionProfile = {
  timezone: string
  locale: string
}

/** 换号原因，与 LocalRuntime 一致。 */
export type SessionAccountSwitchReason = "initial" | "switch" | "quota"

/** session.account-switched 事件；只含账号 id 和原因。 */
export type SessionAccountSwitchedEvent = {
  type: "account-switched"
  from: string | null
  to: string
  reason: SessionAccountSwitchReason
}

/** SessionHost 发给 preload 的全部事件：适配器事件加权限和换号。 */
export type SessionHostEvent = SessionEvent | PermissionRequestEvent | SessionAccountSwitchedEvent

/** 设计第 12 节的稳定错误码；SESSION_START_FAILED 来自第 13 节的配置目录失败分支。 */
export type SessionErrorCode =
  | "MEMBERSHIP_REQUIRED"
  | "WORKSPACE_UNAVAILABLE"
  | "NO_AVAILABLE_ACCOUNT"
  | "CLAUDE_RUNTIME_UNAVAILABLE"
  | "DAEMON_UNAVAILABLE"
  | "PROXY_UNAVAILABLE"
  | "AUTH_EXPIRED"
  | "PERMISSION_TIMEOUT"
  | "SESSION_ALREADY_ACTIVE"
  | "SESSION_CANCELLED"
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

/** preload 暴露给 renderer 的 session 命名空间；只有设计第 12 节的命令和事件。 */
export type SessionBridge = {
  start: (input: SessionStartInput) => Promise<{ sessionId: string }>
  send: (input: SessionSendInput) => Promise<void>
  cancel: () => Promise<void>
  respondPermission: (input: PermissionAnswer) => Promise<void>
  setMode: (mode: SessionPermissionMode) => Promise<void>
  setModel: (model: string) => Promise<void>
  stop: () => Promise<void>
  models: () => Promise<ClaudeModel[]>
  status: () => Promise<SessionStatusView>
  subscribe: (listener: (event: SessionHostEvent) => void) => () => void
}

/** preload 暴露的只读用量命名空间。 */
export type UsageBridge = {
  summary: (input: { range: UsageRange }) => Promise<UsageSummary>
}

export type {
  ClaudeModel,
  PermissionAnswer,
  PermissionRequestEvent,
  SessionEvent,
  SessionPermissionMode,
  SessionThinking,
  UsageRange,
  UsageSummary,
}
