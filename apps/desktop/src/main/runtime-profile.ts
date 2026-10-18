// 负责在 Electron 单实例锁之前选择当前运行的用户数据目录。
import { mkdirSync } from "node:fs"

/** 只依赖 Electron app 的目录与单实例能力。 */
export type RuntimeProfileApp = {
  setPath(name: "userData", value: string): void
  requestSingleInstanceLock(): boolean
}

/** 为当前运行取得单实例锁。 */
export function configureRuntimeProfile(app: RuntimeProfileApp, userData?: string): boolean {
  if (userData) {
    mkdirSync(userData, { recursive: true, mode: 0o700 })
    app.setPath("userData", userData)
  }
  return app.requestSingleInstanceLock()
}
