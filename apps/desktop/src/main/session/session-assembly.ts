// 负责在主进程里装配会话服务：用量记录器、会话宿主，以及把会话事件转给主窗口。

import { join } from "node:path"
import type { LocalStore } from "@pigclaude/local-store"
import type { CapabilityPluginToolDependencies } from "../plugins/capability-plugin-tool-dependencies"
import { accountSessionProfile } from "./account-session-profile"
import { resolveClaudeBinaryPath } from "./claude-binary"
import { devProviderHostOptions } from "./dev-provider"
import { ProjectPermissionStore } from "./project-permission-store"
import { SessionHost } from "./session-host"
import type { SessionEnvelope } from "./session-envelope"
import type { SessionMembership, SessionRuntime } from "./session-types"
import type { SessionStore } from "./session-store"
import { UsageRecorder } from "./usage-recorder"
import { trackSessionCommandCatalogs } from "./session-command-catalogs"

/** 装配会话服务所需的应用环境。 */
export type SessionAssemblyInput = {
  userDataPath: string
  /** 没有指定工作区时的默认目录。 */
  homePath: string
  membership: SessionMembership
  /** 没有本机账号存储时为 null，此时不创建会话宿主。 */
  runtime: SessionRuntime | null
  store: Pick<LocalStore, "listAccounts" | "listProxies">
  systemLocale: () => string
  isPackaged: boolean
  env: Record<string, string | undefined>
  /** 会话事件出口；事件都已脱敏并包在信封里。 */
  onEvent: (envelope: SessionEnvelope) => void
  /** 此窗口启动时打开的会话存储；不阻塞登录和窗口创建。 */
  sessionStore?: Promise<SessionStore | null>
  /** 桌面装配了能力插件管理器、沙箱和按会话出口时启用。 */
  capabilityPluginTools?: CapabilityPluginToolDependencies
}

/** 主进程持有的会话服务。 */
export type SessionServices = {
  usage: UsageRecorder
  host: SessionHost | null
  projectPermissions: ProjectPermissionStore
  /** 未打包的开发供应商自行鉴权，不占用 Claude 账号。 */
  usesDevProvider: boolean
}

/** 创建用量记录器和会话宿主，并订阅会话事件。保证没有运行时时不创建会话宿主。 */
export function assembleSessionServices(input: SessionAssemblyInput): SessionServices {
  const usage = new UsageRecorder({ filePath: join(input.userDataPath, "usage.jsonl") })
  const projectPermissions = new ProjectPermissionStore(
    join(input.userDataPath, "project-permissions.json"),
  )
  if (input.runtime === null)
    return { usage, host: null, projectPermissions, usesDevProvider: false }
  const devProvider = devProviderHostOptions(input.isPackaged, input.env)
  const host = new SessionHost({
    membership: input.membership,
    runtime: input.runtime,
    usage,
    projectPermissions,
    userDataPath: input.userDataPath,
    resolveBinaryPath: () => resolveClaudeBinaryPath(),
    defaultWorkspace: () => input.homePath,
    resolveProfile: (accountId, required) =>
      accountSessionProfile(input.store, accountId, input.systemLocale, required),
    ...(input.sessionStore === undefined ? {} : { sessionStore: input.sessionStore }),
    ...(input.capabilityPluginTools === undefined
      ? {}
      : { capabilityPluginTools: input.capabilityPluginTools }),
    ...devProvider,
  })
  trackSessionCommandCatalogs(host)
  host.subscribe(input.onEvent)
  return { usage, host, projectPermissions, usesDevProvider: devProvider.provider !== undefined }
}
