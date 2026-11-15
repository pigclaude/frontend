// 定义会话宿主装配所需的端口，并让测试能注入时钟、适配器和存储。

import type { OrganizationModelReader } from "./claude-bootstrap"
import type { DevProviderOverride } from "./dev-provider"
import type { SessionTimers } from "./session-host-active"
import type { SessionLaunchDeps } from "./session-launch"
import type { SessionStore } from "./session-store"
import type {
  SessionAdapterFactory,
  SessionEnvironmentFactory,
  SessionMembership,
  SessionRuntime,
  SessionUsagePort,
} from "./session-types"

/** SessionHost 的依赖，允许测试在不启动真实 CLI 的情况下运行。 */
export type SessionHostOptions = {
  membership: SessionMembership
  runtime: SessionRuntime
  usage: SessionUsagePort
  userDataPath: string
  createEnvironment?: SessionEnvironmentFactory
  createAdapter?: SessionAdapterFactory
  resolveBinaryPath?: () => string
  resolveProfile?: SessionLaunchDeps["resolveProfile"]
  /** 桌面启动时打开的会话存储。 */
  sessionStore?: Promise<SessionStore | null>
  /** 经 daemon 读当前账号的组织模型，缺省时使用随包 CLI 的 bootstrap 请求。 */
  readOrganizationModels?: OrganizationModelReader
  /** 只在未打包时提供的开发期供应商。 */
  provider?: DevProviderOverride | null
  defaultWorkspace?: () => string
  permissionTimeoutMs?: number
  /** 同时运行的 Claude Code 进程上限，默认 4。 */
  maxRunningSessions?: number
  /** 等候启动的会话上限，默认 8。 */
  maxQueuedSessions?: number
  /** 空闲多久自动停放，默认 30 分钟。 */
  idleParkMs?: number
  timers?: SessionTimers
  now?: () => number
  newId?: () => string
} & Pick<SessionLaunchDeps, "projectPermissions">
