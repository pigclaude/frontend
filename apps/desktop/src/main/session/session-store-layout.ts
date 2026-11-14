// 定义会话存储的目录布局：userData 下的根目录、每个会话一个目录，以及目录里索引、时间线、
// Claude Code 配置目录和临时目录的位置。只算路径，不创建目录。

import { join } from "node:path"

/** userData 下会话存储根目录的名字；与只给模型目录查询用的 sessions/ 分开。 */
export const sessionStoreDirName = "session-store"

/** 会话目录和根目录的权限。 */
export const sessionStoreDirMode = 0o700

/** 索引和时间线文件的权限。 */
export const sessionStoreFileMode = 0o600

const indexFileName = "index.json"
const timelineFileName = "timeline.jsonl"
const claudeConfigDirName = "claude"
const claudeTmpDirName = "tmp"
const sessionIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

/** 一个会话目录里各部分的绝对路径。 */
export type SessionStorePaths = {
  directory: string
  indexFile: string
  timelineFile: string
  /** Claude Code 的配置目录（CLAUDE_CONFIG_DIR），会话记录也在这里；由接入会话环境的一方创建。 */
  claudeConfigDir: string
  /** Claude Code 的临时目录（CLAUDE_CODE_TMPDIR）；由接入会话环境的一方创建。 */
  claudeTmpDir: string
}

/** 会话存储在 userData 下的根目录。 */
export function sessionStoreRoot(userDataPath: string): string {
  return join(userDataPath, sessionStoreDirName)
}

/** 会话 id 能否直接用作目录名：字母或数字开头，只含字母、数字、下划线和短横线。 */
export function isSessionStoreId(id: string): boolean {
  return sessionIdPattern.test(id)
}

/** 会话目录各部分的路径；id 不能用作目录名时抛错，保证路径不会离开根目录。 */
export function sessionStorePaths(root: string, id: string): SessionStorePaths {
  if (!isSessionStoreId(id)) throw new Error("invalid session id")
  const directory = join(root, id)
  return {
    directory,
    indexFile: join(directory, indexFileName),
    timelineFile: join(directory, timelineFileName),
    claudeConfigDir: join(directory, claudeConfigDirName),
    claudeTmpDir: join(directory, claudeTmpDirName),
  }
}

/** 文件名是不是索引写到一半留下的临时文件。 */
export function isIndexTemporaryFile(name: string): boolean {
  return name.startsWith(`.${indexFileName}.`) && name.endsWith(".tmp")
}

/** 索引临时文件的路径；同目录，改名替换索引时是原子的。 */
export function indexTemporaryFile(directory: string, unique: string): string {
  return join(directory, `.${indexFileName}.${unique}.tmp`)
}
