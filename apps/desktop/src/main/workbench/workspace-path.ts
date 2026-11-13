// 负责解析已登记的项目目录和安全的工作区内相对路径。
import { lstat, realpath, stat } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep, win32 } from "node:path"

/** 校验项目仍然存在，并返回解析符号链接后的绝对目录。 */
export async function workspaceDirectory(
  value: unknown,
  roots: readonly string[],
): Promise<string> {
  if (typeof value !== "string" || !isAbsolute(value) || !roots.includes(value)) {
    throw new Error("WORKBENCH_PROJECT_REQUIRED")
  }
  try {
    const root = await realpath(value)
    if ((await stat(root)).isDirectory()) return root
  } catch {
    // 移除或移动的项目与不存在的项目用同一个错误。
  }
  throw new Error("WORKBENCH_PROJECT_REQUIRED")
}

/** 校验工作区文件的相对路径；管理目录和链接不作为工作台读写目标。 */
export async function workspacePath(root: string, path: unknown): Promise<string> {
  if (
    typeof path !== "string" ||
    path.length > 4096 ||
    path.includes("\0") ||
    path.includes("\\")
  ) {
    throw new Error("WORKBENCH_PATH_INVALID")
  }
  if (path === "") return root
  const parts = path.split("/")
  if (isAbsolute(path) || win32.isAbsolute(path) || parts.some(invalidSegment)) {
    throw new Error("WORKBENCH_PATH_INVALID")
  }
  const absolute = resolve(root, ...parts)
  const canonical = await realpath(absolute)
  const nested = relative(root, canonical)
  if (
    !nested ||
    nested === ".." ||
    nested.startsWith(".." + sep) ||
    isAbsolute(nested) ||
    canonical !== absolute
  ) {
    throw new Error("WORKBENCH_PATH_INVALID")
  }
  return absolute
}

function invalidSegment(name: string): boolean {
  return (
    name === "" ||
    name === "." ||
    name === ".." ||
    [".git", ".claude"].includes(name.toLowerCase()) ||
    name.includes(":")
  )
}

/** 判断资源管理器是否可以列出指定条目；隐藏应用配置目录与版本库内部。 */
export function visibleWorkspaceEntry(name: string): boolean {
  return !invalidSegment(name) && !["node_modules", ".claude", ".superpowers"].includes(name)
}

/** 确认本地文件当前仍是普通文件，供保存前的版本核对使用。 */
export async function workspaceFileInfo(path: string) {
  const info = await lstat(path)
  if (!info.isFile()) throw new Error("WORKBENCH_PATH_INVALID")
  return info
}
