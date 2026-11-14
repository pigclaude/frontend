// 负责主进程入口测试里的更新服务替身：不发请求、不安排定时器，退出时不要求重启安装。
import type { UpdateService } from "../updates/update-service"

/** 什么都不做的更新服务；入口测试用 vi.mock 换掉 createAppUpdates 时返回它。 */
export function createAppUpdates(): UpdateService {
  const state = {
    autoCheck: false,
    phase: "idle",
    currentVersion: "0.0.0",
    version: null,
    url: null,
    action: null,
    progress: null,
    error: null,
  } as const
  return {
    start: () => undefined,
    stop: () => undefined,
    getState: () => state,
    checkNow: async () => ({ status: "up-to-date" }),
    perform: async () => state,
    setAutoCheck: async () => state,
    openReleaseNotes: async () => undefined,
    restartRequested: () => false,
    cancelRestart: () => undefined,
    installAndRestart: async () => undefined,
  }
}
