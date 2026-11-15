// 预加载只公开定时任务的固定操作和刷新订阅，主进程校验来源及参数。

import { ipcRenderer } from "electron"
import {
  scheduledTaskChannelPrefix,
  scheduledTasksChangedChannel,
  type ScheduledTasksBridge,
} from "../scheduled-tasks-contract"

/** 创建桌面定时任务的设置桥。 */
export function scheduledTasksBridge(): ScheduledTasksBridge {
  const invoke = (command: string, ...args: unknown[]) =>
    ipcRenderer.invoke(scheduledTaskChannelPrefix + command, ...args)
  return {
    list: () => invoke("list"),
    create: (input) => invoke("create", input),
    update: (id, input) => invoke("update", id, input),
    setEnabled: (id, enabled) => invoke("set-enabled", id, enabled),
    remove: (id) => invoke("remove", id),
    runNow: (id) => invoke("run-now", id),
    runs: (id, offset, limit) => invoke("runs", id, offset, limit),
    removeRun: (taskId, runId) => invoke("remove-run", taskId, runId),
    subscribe(listener) {
      const receive = () => listener()
      ipcRenderer.on(scheduledTasksChangedChannel, receive)
      return () => ipcRenderer.removeListener(scheduledTasksChangedChannel, receive)
    },
  }
}
