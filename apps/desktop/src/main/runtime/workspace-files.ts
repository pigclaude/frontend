// 负责给输入区的 @ 引用列出工作区里的文件；只读、跳过依赖和版本库目录，并限制条数与深度。

import { readdir, stat } from "node:fs/promises"
import { isAbsolute, join } from "node:path"

/** 单次最多返回的文件数，避免把整个大仓库塞进建议列表。 */
export const WORKSPACE_FILE_LIMIT = 2000

/** 递归深度上限，防止很深的目录拖慢主进程。 */
const MAX_DEPTH = 12

/** 不列出的目录：依赖、版本库和构建产物。 */
const ignoredDirs = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "out",
  "build",
  "target",
  "coverage",
  ".next",
])

/** 列出工作区里的相对路径；始终跳过链接和忽略目录，默认也跳过隐藏条目。 */
export async function listWorkspaceFiles(
  root: string,
  limit = WORKSPACE_FILE_LIMIT,
  visible: (path: string, name: string) => boolean = (_path, name) => !name.startsWith("."),
): Promise<string[]> {
  if (!isAbsolute(root)) throw new Error("WORKSPACE_UNAVAILABLE: 工作区必须是绝对路径")
  const info = await stat(root).catch(() => null)
  if (info === null || !info.isDirectory()) {
    throw new Error("WORKSPACE_UNAVAILABLE: 工作区不存在")
  }
  const files: string[] = []
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || files.length >= limit) return
    const entries = await readdir(join(root, directory), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (files.length >= limit) return
      const path = directory ? directory + "/" + entry.name : entry.name
      if (entry.isSymbolicLink() || !visible(path, entry.name)) continue
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) await walk(path, depth + 1)
      } else if (entry.isFile()) {
        files.push(path)
      }
    }
  }
  await walk("", 0)
  return files.sort()
}
