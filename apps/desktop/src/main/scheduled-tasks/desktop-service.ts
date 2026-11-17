// 把本机调度接到桌面的实时会员门禁、会话默认项与 daemon，不接触提示词或凭据的日志。

import { join } from "node:path"
import type { DesktopComposition } from "../composition"
import type { LocalRuntime } from "../runtime/local-runtime"
import type { SessionDefaultsStore } from "../runtime/session-defaults"
import type { SessionServices } from "../session/session-assembly"
import { assertWorkspace } from "../session/session-host-support"
import { WorktreeRegistry } from "../workbench/worktree-registry"
import {
  observeScheduledTaskPresentation,
  type ScheduledTaskPresentationOptions,
} from "./presentation"
import { createScheduledTaskRunner, type ScheduledTaskRunnerPorts } from "./runner"
import { ScheduledTaskService } from "./service"
import { runScheduledWorkspace } from "./workspace"

/** 会话宿主与本机 runtime 就绪后，从同一套桌面依赖装配调度器。 */
export function setupDesktopScheduledTasks(options: {
  userDataPath: string
  composition: DesktopComposition
  sessions: SessionServices
  defaults: Pick<SessionDefaultsStore, "get">
  presentation: Omit<ScheduledTaskPresentationOptions, "service">
}): ScheduledTaskService | null {
  const { userDataPath, composition, sessions, defaults, presentation } = options
  const { runtime } = composition
  const { host, usesDevProvider } = sessions
  if (!runtime || !host) return null
  return createDesktopScheduledTaskService({
    userDataPath,
    authorization: composition,
    runtime,
    defaults,
    usesDevProvider,
    runSession: host.runScheduledTask.bind(host),
    presentation,
  })
}

/** 为当前桌面配置建立一个调度服务，启动时间和关停顺序由应用管理。 */
export function createDesktopScheduledTaskService(options: {
  userDataPath: string
  authorization: Pick<DesktopComposition, "runAuthorized">
  runtime: Pick<LocalRuntime, "hasAvailableAccount" | "start" | "daemonBaseUrl">
  defaults: Pick<SessionDefaultsStore, "get">
  usesDevProvider: boolean
  runSession: ScheduledTaskRunnerPorts["runSession"]
  presentation: Omit<ScheduledTaskPresentationOptions, "service">
}): ScheduledTaskService {
  let membershipChecks = Promise.resolve()
  const worktrees = new WorktreeRegistry({ filePath: join(options.userDataPath, "worktrees.json") })
  const runner = createScheduledTaskRunner({
    checkMembership: (signal) => {
      // 同时到点的任务按顺序核验，避免较新的检查使同批较早的授权结果失效。
      const checked = membershipChecks.then(() =>
        signal.aborted ? false : options.authorization.runAuthorized(async () => true),
      )
      membershipChecks = checked.then(
        () => undefined,
        () => undefined,
      )
      return checked
    },
    checkProject: async (projectPath) => {
      await assertWorkspace(projectPath)
      return true
    },
    checkAccount: async () =>
      options.usesDevProvider || (await options.runtime.hasAvailableAccount()),
    startDaemon: async () => {
      await options.runtime.start()
      return options.runtime.daemonBaseUrl !== null
    },
    defaultModel: async () => (await options.defaults.get()).model,
    runSession: (task, signal) =>
      runScheduledWorkspace(task, signal, worktrees, options.runSession),
  })
  const service = new ScheduledTaskService({
    filePath: join(options.userDataPath, "scheduled-tasks.json"),
    run: ({ task }, signal) => runner(task, signal),
    reportError: reportScheduledTasksError,
  })
  observeScheduledTaskPresentation({ ...options.presentation, service })
  return service
}

/** 调度失败只记固定错误码，避免把本机任务内容带入日志。 */
export function reportScheduledTasksError(): void {
  console.error("SCHEDULED_TASKS_UNAVAILABLE")
}
