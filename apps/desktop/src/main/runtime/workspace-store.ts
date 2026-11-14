// 负责读写 <userData>/workspaces.json：只保存最近使用的绝对工作区路径，
// 最新在前、去重、最多 10 条，不写提示词、回复或任何凭据。

import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { access, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { dirname, isAbsolute } from "node:path"

const defaultMaxEntries = 10

/** 工作区存储依赖；文件路径由 main 用 userData 拼出，测试可用临时目录。 */
export type WorkspaceStoreOptions = {
  filePath: string
  maxEntries?: number
}

/** 最近工作区文件。保证写入只包含路径数组；损坏或半写文件按空列表处理。 */
export class WorkspaceStore {
  readonly #filePath: string
  readonly #maxEntries: number

  /** 创建绑定到固定文件的存储；默认最多保留 10 条。 */
  constructor(options: WorkspaceStoreOptions) {
    this.#filePath = options.filePath
    this.#maxEntries = options.maxEntries ?? defaultMaxEntries
  }

  /** 返回最近工作区，最新在前；文件不存在、损坏或包含非路径条目时只返回合法绝对路径。 */
  async list(): Promise<string[]> {
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(this.#filePath, "utf8"))
    } catch {
      return []
    }
    if (!Array.isArray(raw)) return []
    const paths: string[] = []
    for (const item of raw) {
      const path = typeof item === "string" ? normalizeWorkspacePath(item) : null
      if (path !== null && !paths.includes(path)) paths.push(path)
      if (paths.length >= this.#maxEntries) break
    }
    return paths
  }

  /** 只返回仍可读的最近工作区，保留顺序及原有的项目列表。 */
  async available(): Promise<string[]> {
    const paths = await this.list()
    const accessible = await Promise.all(
      paths.map(async (path) => {
        const readable = await access(path, constants.R_OK).then(
          () => true,
          () => false,
        )
        return readable && (await isDirectory(path))
      }),
    )
    return paths.filter((_, index) => accessible[index])
  }

  /** 把路径放到最前并去重；拒绝相对路径、不存在的路径和非目录，返回写入后的完整列表。 */
  async add(value: string): Promise<string[]> {
    const path = normalizeWorkspacePath(value)
    if (path === null) throw new Error("WORKSPACE_UNAVAILABLE: 工作区必须是绝对路径")
    if (!(await isDirectory(path))) {
      throw new Error("WORKSPACE_UNAVAILABLE: 工作区不存在或不是目录")
    }
    const current = await this.list()
    const next = [path, ...current.filter((item) => item !== path)].slice(0, this.#maxEntries)
    await this.#write(next)
    return next
  }

  /** 从列表里去掉 path，不碰文件夹本身；不在列表里时不写文件。返回去掉后的完整列表。 */
  async remove(value: string): Promise<string[]> {
    const path = normalizeWorkspacePath(value)
    const current = await this.list()
    if (path === null || !current.includes(path)) return current
    const next = current.filter((item) => item !== path)
    await this.#write(next)
    return next
  }

  // 先写同目录临时文件再改名，避免应用退出时留下半截 JSON。
  async #write(paths: string[]): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true, mode: 0o700 })
    const temporary = `${this.#filePath}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(paths, null, 2), { encoding: "utf8", mode: 0o600 })
    await rename(temporary, this.#filePath)
  }
}

function normalizeWorkspacePath(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed === "" || !isAbsolute(trimmed)) return null
  const withoutTrailing = trimmed.replace(/[\\/]+$/, "")
  return withoutTrailing === "" ? trimmed : withoutTrailing
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}
