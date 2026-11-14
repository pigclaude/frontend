// 负责打开会话存储时的目录清理：没有索引、修改时间超过 1 小时的目录整个删除，
// 会话目录里写索引中途崩溃留下的临时文件删掉。

import { readdir, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { isIndexTemporaryFile } from "./session-store-layout"

/** 没有索引的目录超过这个时长才清理；更新的目录可能正在创建。 */
export const orphanDirectoryAgeMs = 60 * 60 * 1000

/** 删除没有索引的目录：修改时间早于 now 超过 1 小时才删，返回是否删了。 */
export async function removeOrphanDirectory(directory: string, now: number): Promise<boolean> {
  const { mtimeMs } = await stat(directory)
  if (now - mtimeMs <= orphanDirectoryAgeMs) return false
  await rm(directory, { recursive: true, force: true })
  return true
}

/** 删除会话目录里残留的索引临时文件，其他文件不动。 */
export async function removeIndexTemporaryFiles(directory: string): Promise<void> {
  const names = await readdir(directory)
  await Promise.all(
    names.filter(isIndexTemporaryFile).map((name) => rm(join(directory, name), { force: true })),
  )
}
