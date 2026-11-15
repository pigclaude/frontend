// 定义构造单个会话的依赖和续接时可保存的 SDK 设置。

import type { ClaudeSession } from "./claude-session"
import type { ClaudePersistenceOptions } from "./claude-query-options"
import type { DevProviderOverride } from "./dev-provider"
import type { SessionEnvelope } from "./session-envelope"
import type { SessionEventCursor } from "./session-event-log"
import type { SessionUsage } from "./session-events"
import type { SessionTimers } from "./session-host-active"
import type { SessionProjectPermissions } from "./session-project-permissions"
import type { SessionReferenceAccess } from "./session-reference-access"
import type {
  SessionAdapterFactory,
  SessionEnvironmentPort,
  SessionStartInput,
} from "./session-types"
import type { UsageRecord } from "./usage-recorder"

/** 构造一个会话所需的全部依赖；都只属于这一个会话。 */
export type ClaudeSessionOptions = {
  sessionId: string
  /** 已按开发期供应商固定过模型的启动输入。 */
  input: SessionStartInput
  environment: SessionEnvironmentPort
  createAdapter: SessionAdapterFactory
  /** 事件出口；收到的事件都已脱敏，并已盖上这个会话的时间和序号。 */
  emit: (envelope: SessionEnvelope) => void
  recordUsage: (record: UsageRecord) => void
  /** 当前 daemon 会话令牌，只用于从错误文本里去掉它。 */
  sessionToken: () => string
  /** 在停止不再安全的会话前立即吊销 daemon 路由。 */
  revokeRouting?: () => void
  provider: DevProviderOverride | null
  permissionTimeoutMs: number
  timers: SessionTimers
  now: () => number
  newId: () => string
  /** 会话释放后调用一次，宿主据此放下对它的引用。 */
  onReleased: (session: ClaudeSession) => unknown
  /** 撤销无法热更新时，交回宿主按正常流程停放。 */
  parkAfterRevocation?: () => Promise<void>
  /** 保存会话用的 SDK 选项和磁盘时间线起点。 */
  persistence?: ClaudePersistenceOptions & {
    cursor: SessionEventCursor
    usageBaseline?: SessionUsage
  }
  /** 已确认的模型或回合设置改变时保存索引。 */
  saveSettings?: (settings: SessionSavedSettings) => void
  references?: SessionReferenceAccess
  projectPermissions?: SessionProjectPermissions
}

/** 会话实际生效的模型与 SDK 已确认的设置。 */
export type SessionSavedSettings = {
  model: string | null
  effort: NonNullable<SessionStartInput["effort"]> | null
  fast: boolean
}
