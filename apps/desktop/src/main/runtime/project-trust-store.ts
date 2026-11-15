// 保存经确认信任的真实项目目录；读写只使用桌面端的本机偏好文件。
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, relative } from "node:path"
import { resolveProjectConfigurationScope } from "../session/project-configuration-scope"

/** 同一份本机信任数据供项目卡片和后续会话启动读取。 */
export function projectTrustFilePath(userDataPath: string): string {
  return join(userDataPath, "project-trust.json")
}

/** 信任记录按真实目录去重，损坏或缺失的文件按从未信任处理。 */
export class ProjectTrustStore {
  #writes = Promise.resolve()

  /** 绑定本机信任文件；测试可指定不含用户数据的主目录。 */
  constructor(
    private readonly filePath: string,
    private readonly userHome?: string,
  ) {}

  /** 未登记、已不存在或个人配置路径都不会得到信任。 */
  async isTrusted(path: string): Promise<boolean> {
    const project = await this.#project(path)
    if (project === null) return false
    await this.#writes
    return (await this.#read()).some((item) => relative(item, project) === "")
  }

  /** 串行更新已确认的真实路径，不跟随写入前被替换的目录别名。 */
  async setTrusted(path: string, trusted: boolean): Promise<void> {
    const run = this.#writes.then(async () => {
      const project = await this.#project(path)
      if (project === null || relative(path, project) !== "")
        throw new Error("PROJECT_TRUST_BLOCKED")
      const paths = await this.#read()
      const next = paths.filter((item) => relative(item, project) !== "")
      if (trusted) next.push(project)
      await this.#write(next)
    })
    this.#writes = run.catch(() => undefined)
    return run
  }

  async #project(path: string): Promise<string | null> {
    if (!isAbsolute(path)) return null
    try {
      const scope = await resolveProjectConfigurationScope(path, this.userHome)
      return scope.directories[0] ?? null
    } catch {
      return null
    }
  }

  async #read(): Promise<string[]> {
    try {
      const value: unknown = JSON.parse(await readFile(this.filePath, "utf8"))
      return Array.isArray(value)
        ? value.filter((path): path is string => typeof path === "string" && isAbsolute(path))
        : []
    } catch {
      return []
    }
  }

  async #write(paths: string[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
    const temporary = `${this.filePath}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(paths, null, 2), {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      })
      await rename(temporary, this.filePath)
    } finally {
      await rm(temporary, { force: true })
    }
  }
}
