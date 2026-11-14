// 负责在主进程启动时打开会话存储（扫描建内存索引、启动收敛、清理孤儿目录）。
// 打开失败只记日志，不阻止应用启动。

import { errorMessage } from "../error-message"
import { SessionStore, type SessionStoreOptions } from "./session-store"
import { sessionStoreRoot } from "./session-store-layout"

/** 启动时打开存储的可替换依赖。 */
export type SessionStoreStartupOptions = {
  open?: (options: SessionStoreOptions) => Promise<SessionStore>
  log?: (message: string) => void
}

/** 在 userData 下打开会话存储；保证返回的 Promise 不会拒绝，失败时给出 null 并记日志。 */
export function startSessionStore(
  userDataPath: string,
  options: SessionStoreStartupOptions = {},
): Promise<SessionStore | null> {
  const open = options.open ?? ((input: SessionStoreOptions) => SessionStore.open(input))
  const log = options.log ?? ((message: string) => console.warn(message))
  return open({ root: sessionStoreRoot(userDataPath), log }).catch((error: unknown) => {
    log(`会话存储打开失败：${errorMessage(error)}`)
    return null
  })
}
