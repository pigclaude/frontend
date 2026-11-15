// 为工作台读取文件树和有限大小的预览，并在保存时核对磁盘版本。
import { constants } from "node:fs"
import { open, readdir, rename, unlink } from "node:fs/promises"
import { basename, dirname, extname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import type { WorkbenchListing, WorkbenchSearch, WorkbenchFile } from "../../workbench-contract"
import { listWorkspaceFiles, WORKSPACE_FILE_LIMIT } from "../runtime/workspace-files"
import { protectedWorkbenchPath } from "./hidden-paths"
import { visibleWorkspaceEntry, workspaceFileInfo, workspacePath } from "./workspace-path"

const maxTextBytes = 512 * 1024
const maxImageBytes = 4 * 1024 * 1024
const maxDirectoryEntries = 1000
const saves = new Map<string, Promise<WorkbenchFile>>()
const imageTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
}

/** 读取一层目录，省略链接和特殊文件，保留工作区相对路径；目录在前，按名字的自然顺序排列。 */
export async function listWorkbenchDirectory(
  root: string,
  path: string,
): Promise<WorkbenchListing> {
  const absolute = await workspacePath(root, path)
  const entries = (await readdir(absolute, { withFileTypes: true }))
    .filter(
      (entry) => visibleWorkspaceEntry(path, entry.name) && (entry.isDirectory() || entry.isFile()),
    )
    .map((entry) => ({
      name: entry.name,
      path: path ? path + "/" + entry.name : entry.name,
      kind: entry.isDirectory() ? ("directory" as const) : ("file" as const),
    }))
    .sort((left, right) =>
      left.kind === right.kind
        ? left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
        : left.kind === "directory"
          ? -1
          : 1,
    )
  return {
    truncated: entries.length > maxDirectoryEntries,
    entries: entries.slice(0, maxDirectoryEntries),
  }
}

/** 在有限的可见文件中搜索路径，包含项目配置并补齐匹配的祖先目录。 */
export async function searchWorkbenchFiles(root: string, query: string): Promise<WorkbenchSearch> {
  const matches = new Map<string, "directory" | "file">()
  const terms = query.trim().toLowerCase().split(/\s+/)
  const files = await listWorkspaceFiles(
    root,
    WORKSPACE_FILE_LIMIT,
    (path, name) =>
      !protectedWorkbenchPath(path) &&
      (!name.startsWith(".") || /^\.(claude|mcp\.json)$/i.test(name)),
  )
  for (const file of files) {
    const parts = file.split("/")
    for (let depth = 1; depth <= parts.length; depth += 1) {
      const path = parts.slice(0, depth).join("/")
      if (terms.every((term) => path.toLowerCase().includes(term))) {
        matches.set(path, depth === parts.length ? "file" : "directory")
      }
    }
  }
  return {
    truncated: matches.size > maxDirectoryEntries,
    entries: [...matches].slice(0, maxDirectoryEntries).map(([path, kind]) => ({ path, kind })),
  }
}

/** 返回普通文件的有界内容、换行样式和版本。图片只允许安全的栅格类型。 */
export async function readWorkbenchFile(root: string, path: string): Promise<WorkbenchFile> {
  const absolute = await workspacePath(root, path)
  const info = await workspaceFileInfo(absolute)
  const mime = imageTypes[extname(absolute).toLowerCase()]
  const limit = mime ? maxImageBytes : maxTextBytes
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const size = Math.min(info.size, limit)
    const opened = await handle.stat()
    if (!opened.isFile() || opened.ino !== info.ino || opened.mtimeMs !== info.mtimeMs) {
      throw new Error("WORKBENCH_FILE_CHANGED")
    }
    const buffer = Buffer.alloc(size)
    const { bytesRead } = await handle.read(buffer, 0, size, 0)
    const data = buffer.subarray(0, bytesRead)
    const truncated = info.size > bytesRead
    const image = mime && !truncated ? { mime, base64: data.toString("base64") } : undefined
    let text = ""
    let binary = mime !== undefined || data.includes(0)
    if (!binary) {
      try {
        text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data, {
          stream: truncated,
        })
      } catch {
        binary = true
      }
    }
    return {
      path,
      text,
      binary,
      truncated,
      size: info.size,
      mtimeMs: info.mtimeMs,
      eol: text.includes("\r\n") ? "crlf" : "lf",
      ...(image ? { image } : {}),
    }
  } finally {
    await handle.close()
  }
}

/** 写回文本并保留换行与文件权限；磁盘已变化时需要用户明确覆盖。 */
export async function saveWorkbenchFile(
  root: string,
  path: string,
  text: string,
  expectedMtime: number | null,
): Promise<WorkbenchFile> {
  if (Buffer.byteLength(text) > maxTextBytes) throw new Error("WORKBENCH_FILE_TOO_LARGE")
  const absolute = await workspacePath(root, path)
  const previous = saves.get(absolute)
  const task = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() =>
    replaceWorkbenchFile(root, path, text, expectedMtime, absolute),
  )
  saves.set(absolute, task)
  try {
    return await task
  } finally {
    if (saves.get(absolute) === task) saves.delete(absolute)
  }
}

async function replaceWorkbenchFile(
  root: string,
  path: string,
  text: string,
  expectedMtime: number | null,
  absolute: string,
): Promise<WorkbenchFile> {
  if ((await workspacePath(root, path)) !== absolute) throw new Error("WORKBENCH_FILE_CHANGED")
  const previous = await readWorkbenchFile(root, path)
  if (previous.binary || previous.truncated) throw new Error("WORKBENCH_FILE_READ_ONLY")
  if (expectedMtime !== null && previous.mtimeMs !== expectedMtime) {
    throw new Error("WORKBENCH_FILE_CHANGED")
  }
  const temporary = join(dirname(absolute), "." + basename(absolute) + "." + randomUUID() + ".tmp")
  const info = await workspaceFileInfo(absolute)
  if (info.mtimeMs !== previous.mtimeMs) throw new Error("WORKBENCH_FILE_CHANGED")
  try {
    const handle = await open(temporary, "wx", info.mode & 0o777)
    const contents = previous.eol === "crlf" ? text.replace(/\r?\n/g, "\r\n") : text
    try {
      if (Buffer.byteLength(contents) > maxTextBytes) throw new Error("WORKBENCH_FILE_TOO_LARGE")
      await handle.writeFile(contents)
    } finally {
      await handle.close()
    }
    for (let attempt = 0; ; attempt += 1) {
      await workspacePath(root, path)
      const current = await workspaceFileInfo(absolute)
      if (current.mtimeMs !== info.mtimeMs || current.ino !== info.ino) {
        throw new Error("WORKBENCH_FILE_CHANGED")
      }
      try {
        await rename(temporary, absolute)
        break
      } catch (error: unknown) {
        const code = error && typeof error === "object" && "code" in error ? error.code : null
        if (
          process.platform !== "win32" ||
          attempt >= 6 ||
          !["EPERM", "EACCES", "EBUSY"].includes(String(code))
        )
          throw error
        await delay(50 * (attempt + 1))
      }
    }
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
  return readWorkbenchFile(root, path)
}
