// 负责读写 <userData>/worktrees.json：记下工作台建过或选过的 worktree 属于哪个项目，
// 让 worktree 不占最近项目列表也能打开工作台。只保存两个绝对路径，不写任何项目内容。
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { dirname, isAbsolute } from "node:path"

const defaultMaxEntries = 200

type Entry = { path: string; project: string }

/** 登记文件的位置由 main 用 userData 拼出，测试可用临时目录。 */
export type WorktreeRegistryOptions = { filePath: string; maxEntries?: number }

/** worktree 到所属项目的登记。保证损坏或半写的文件按没有登记处理，条数不超过上限。 */
export class WorktreeRegistry {
  readonly #filePath: string
  readonly #maxEntries: number

  /** 绑定到固定文件；默认最多保留 200 条，超出时丢掉最早的。 */
  constructor(options: WorktreeRegistryOptions) {
    this.#filePath = options.filePath
    this.#maxEntries = options.maxEntries ?? defaultMaxEntries
  }

  /**
   * 记下 path 属于 from 所在的项目：from 本身是登记过的 worktree 时，记成它所属的项目。
   * 路径必须是绝对路径。
   */
  async remember(path: string, from: string): Promise<void> {
    if (!isAbsolute(path) || !isAbsolute(from)) throw new Error("WORKBENCH_PATH_INVALID")
    const entries = await this.#read()
    const project = entries.find((entry) => entry.path === from)?.project ?? from
    const next = [...entries.filter((entry) => entry.path !== path), { path, project }]
    await this.#write(next.slice(-this.#maxEntries))
  }

  /** 属于 projects 里某个项目、目录仍然存在的 worktree，按登记顺序。 */
  async roots(projects: readonly string[]): Promise<string[]> {
    const roots: string[] = []
    for (const entry of await this.#read()) {
      if (projects.includes(entry.project) && (await isDirectory(entry.path)))
        roots.push(entry.path)
    }
    return roots
  }

  async #read(): Promise<Entry[]> {
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(this.#filePath, "utf8"))
    } catch {
      return []
    }
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (item): item is Entry =>
        typeof item === "object" &&
        item !== null &&
        typeof item.path === "string" &&
        typeof item.project === "string" &&
        isAbsolute(item.path) &&
        isAbsolute(item.project),
    )
  }

  // 先写同目录临时文件再改名，避免应用退出时留下半截 JSON。
  async #write(entries: Entry[]): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true, mode: 0o700 })
    const temporary = `${this.#filePath}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(entries, null, 2), { encoding: "utf8", mode: 0o600 })
    await rename(temporary, this.#filePath)
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}
