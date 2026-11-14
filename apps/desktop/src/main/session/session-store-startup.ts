// 负责在主进程启动时打开会话存储（扫描建内存索引、启动收敛、清理孤儿目录），并把打开的存储
// 留给之后接入会话宿主的一方取用。打开失败只记日志，不阻止应用启动。

import { errorMessage } from "../error-message"
import { SessionStore, type SessionStoreOptions } from "./session-store"
import { sessionStoreRoot } from "./session-store-layout"

/** 启动时打开存储的可替换依赖；测试用它注入失败。 */
export type SessionStoreStartupOptions = {
  open?: (options: SessionStoreOptions) => Promise<SessionStore>
  log?: (message: string) => void
}

let opening: Promise<SessionStore | null> = Promise.resolve(null)

/** 在 userData 下打开会话存储；保证返回的 Promise 不会拒绝，失败时给出 null 并记日志。 */
export function startSessionStore(
  userDataPath: string,
  options: SessionStoreStartupOptions = {},
): Promise<SessionStore | null> {
  const open = options.open ?? ((input: SessionStoreOptions) => SessionStore.open(input))
  const log = options.log ?? ((message: string) => console.error(message))
  opening = open({ root: sessionStoreRoot(userDataPath), log }).catch((error: unknown) => {
    log(`会话存储打开失败：${errorMessage(error)}`)
    return null
  })
  return opening
}

/** 最近一次 startSessionStore 打开的存储；还没打开或打开失败时为 null。 */
export function startedSessionStore(): Promise<SessionStore | null> {
  return opening
}
