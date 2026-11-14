// 负责读写 <userData>/project-names.json：侧栏项目的显示名，按工作区路径保存。
// 只改侧栏里的名字，不碰项目文件夹；只保存仍在最近工作区里的项目。

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

/** 显示名的最大字符数，和侧栏改名输入框一致。 */
const maxNameLength = 120

/** 显示名存储依赖；文件路径由 main 用 userData 拼出，测试可用临时目录。 */
export type ProjectNameStoreOptions = {
  filePath: string
}

/** 侧栏项目显示名文件。保证只返回和写入登记项目的合法名字；损坏文件按没有名字处理。 */
export class ProjectNameStore {
  readonly #filePath: string

  /** 创建绑定到固定文件的存储。 */
  constructor(options: ProjectNameStoreOptions) {
    this.#filePath = options.filePath
  }

  /** 返回 projects 里各项目的显示名；没改过名的项目不出现。 */
  async names(projects: readonly string[]): Promise<Record<string, string>> {
    const stored = await this.#read()
    return Object.fromEntries(
      projects.flatMap((path) => (stored[path] ? [[path, stored[path]]] : [])),
    )
  }

  /**
   * 把 path 的显示名改成去掉首尾空白后的 name，返回 projects 的全部显示名；
   * 同时丢掉已不在 projects 里的旧名字。名字为空或过长时拒绝。
   */
  async rename(
    path: string,
    name: string,
    projects: readonly string[],
  ): Promise<Record<string, string>> {
    const trimmed = name.trim()
    if (trimmed === "" || [...trimmed].length > maxNameLength || /\p{Cc}/u.test(trimmed)) {
      throw new Error("PROJECT_NAME_INVALID")
    }
    const next = { ...(await this.names(projects)), [path]: trimmed }
    await this.#write(next)
    return this.names(projects)
  }

  /** 去掉 path 的显示名；项目从侧栏移除时调用。 */
  async forget(path: string): Promise<void> {
    const stored = await this.#read()
    if (!(path in stored)) return
    delete stored[path]
    await this.#write(stored)
  }

  async #read(): Promise<Record<string, string>> {
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(this.#filePath, "utf8"))
    } catch {
      return {}
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {}
    return Object.fromEntries(
      Object.entries(raw).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && entry[1].trim() !== "",
      ),
    )
  }

  // 先写同目录临时文件再改名，避免应用退出时留下半截 JSON。
  async #write(names: Record<string, string>): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true, mode: 0o700 })
    const temporary = `${this.#filePath}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(names, null, 2), { encoding: "utf8", mode: 0o600 })
    await rename(temporary, this.#filePath)
  }
}
