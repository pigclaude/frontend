// 把手动唤醒偏好和回合保护接到 Electron 的系统空闲睡眠接口。

import { powerSaveBlocker } from "electron"
import { join } from "node:path"
import { KeepAwake } from "./keep-awake"

/** 使用当前用户数据目录建立本次应用的唤醒管理器。 */
export function createDesktopKeepAwake(userDataPath: string): KeepAwake {
  return new KeepAwake(join(userDataPath, "keep-awake.json"), powerSaveBlocker)
}
