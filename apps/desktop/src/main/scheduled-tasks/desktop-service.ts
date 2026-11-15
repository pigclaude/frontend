// 把本机调度接到桌面的实时会员门禁、会话默认项与 daemon，不接触提示词或凭据的日志。

import { join } from "node:path"
import type { DesktopComposition } from "../composition"
import type { LocalRuntime } from "../runtime/local-runtime"
import type { SessionDefaultsStore } from "../runtime/session-defaults"
import { assertWorkspace } from "../session/session-host-support"
import { createScheduledTaskRunner, type ScheduledTaskRunnerPorts } from "./runner"
import { ScheduledTaskService } from "./service"

/** 为当前桌面配置建立一个调度服务，启动时间和关停顺序由应用管理。 */
export function createDesktopScheduledTaskService(options: {
  userDataPath: string
  authorization: Pick<DesktopComposition, "runAuthorized">
  runtime: Pick<LocalRuntime, "hasAvailableAccount" | "start" | "daemonBaseUrl">
  defaults: Pick<SessionDefaultsStore, "get">
  usesDevProvider: boolean
  runSession: ScheduledTaskRunnerPorts["runSession"]
}): ScheduledTaskService {
  const runner = createScheduledTaskRunner({
    checkMembership: () => options.authorization.runAuthorized(async () => true),
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
    runSession: options.runSession,
  })
  return new ScheduledTaskService({
    filePath: join(options.userDataPath, "scheduled-tasks.json"),
    run: ({ task }, signal) => runner(task, signal),
    reportError: reportScheduledTasksError,
  })
}

/** 调度失败只记固定错误码，避免把本机任务内容带入日志。 */
export function reportScheduledTasksError(): void {
  console.error("SCHEDULED_TASKS_UNAVAILABLE")
}
