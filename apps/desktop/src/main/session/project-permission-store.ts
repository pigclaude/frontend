// 读写 PigClaude 用户目录中的项目授权。逐次提交和同目录改名保留并发更新，不改项目文件。

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, isAbsolute } from "node:path"
import {
  projectPermissionCleanupFailed,
  type ProjectPermissionEntry,
  type ProjectPermissionGrant,
} from "../../project-permissions-contract"
import { workbenchBrowserRule } from "./browser-tool-approval"
import {
  projectPermissionSettings,
  type ProjectPermissionSettings,
} from "./project-permission-grants"

type RuleChange = "grant" | "revoke"
type RuleListener = (settings: ProjectPermissionSettings, change: RuleChange) => Promise<void>

/** 本机项目授权库。更新完成后通知使用同一真实项目路径的活动会话。 */
export class ProjectPermissionStore {
  readonly #filePath: string
  readonly #listeners = new Map<string, Set<RuleListener>>()
  #writes: Promise<unknown> = Promise.resolve()

  /** 绑定用户数据目录中的一个规则文件。 */
  constructor(filePath: string) {
    this.#filePath = filePath
  }

  /** 查询所有可识别的项目授权；缺失或损坏的文件不授予权限。 */
  async list(): Promise<ProjectPermissionEntry[]> {
    const raw: unknown = await readFile(this.#filePath, "utf8").then(
      parseRules,
      (error: unknown) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return []
        throw error
      },
    )
    return Array.isArray(raw) ? raw.filter(isEntry) : []
  }

  /** 读取某个项目传给 SDK 的整份权限对象。 */
  async settings(projectPath: string): Promise<ProjectPermissionSettings> {
    return settingsFor(await this.list(), projectPath)
  }

  /** 只追加已在权限卡确认的规则；请求已取消时不开始提交。 */
  grant(
    projectPath: string,
    grants: readonly ProjectPermissionGrant[],
    active: () => boolean,
  ): Promise<void> {
    if (grants.some(({ kind, value }) => kind === "allow" && workbenchBrowserRule(value)))
      return Promise.reject(new Error("INVALID_SESSION_INPUT"))
    return this.#update(async (entries) => {
      if (!active()) return
      const next = [...entries]
      for (const grant of grants) {
        if (
          next.some(
            (entry) =>
              entry.projectPath === projectPath &&
              entry.kind === grant.kind &&
              entry.value === grant.value,
          )
        )
          continue
        next.push({ ...grant, projectPath, id: randomUUID() })
      }
      if (next.length !== entries.length && (await this.#commit(next, active)))
        void this.#notify(projectPath, next, "grant")
    })
  }

  /** 按 id 撤销，返回更新后的全部规则；已撤销的规则再次撤销也安全。 */
  async revoke(id: string): Promise<ProjectPermissionEntry[]> {
    const { entries, applied } = await this.#update(async (entries) => {
      const removed = entries.find((entry) => entry.id === id)
      if (removed === undefined) return { entries }
      const next = entries.filter((entry) => entry.id !== id)
      await this.#commit(next, () => true)
      return { entries: next, applied: this.#notify(removed.projectPath, next, "revoke") }
    })
    await applied
    return entries
  }

  /** 订阅一个项目，返回解除订阅的操作；不发送其他项目的规则。 */
  subscribe(projectPath: string, listener: RuleListener): () => void {
    const group = this.#listeners.get(projectPath) ?? new Set()
    this.#listeners.set(projectPath, group)
    group.add(listener)
    return () => {
      group.delete(listener)
      if (group.size === 0 && this.#listeners.get(projectPath) === group)
        this.#listeners.delete(projectPath)
    }
  }

  #update<T>(operation: (entries: ProjectPermissionEntry[]) => Promise<T>): Promise<T> {
    const result = this.#writes.then(async () => operation(await this.list()))
    this.#writes = result.catch(() => undefined)
    return result
  }

  async #notify(
    projectPath: string,
    entries: ProjectPermissionEntry[],
    change: RuleChange,
  ): Promise<void> {
    const settings = settingsFor(entries, projectPath)
    const listeners = [...(this.#listeners.get(projectPath) ?? [])]
    const settled = await Promise.allSettled(
      listeners.map(async (listener) => listener(settings, change)),
    )
    if (change === "revoke" && settled.some((result) => result.status === "rejected"))
      throw new Error(projectPermissionCleanupFailed)
  }

  async #commit(entries: ProjectPermissionEntry[], active: () => boolean): Promise<boolean> {
    await mkdir(dirname(this.#filePath), { recursive: true, mode: 0o700 })
    const temporary = `${this.#filePath}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(entries, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      })
      if (!active()) return false
      await rename(temporary, this.#filePath)
      return true
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }
}

function settingsFor(entries: ProjectPermissionEntry[], projectPath: string) {
  return projectPermissionSettings(
    entries.filter(
      ({ projectPath: project, kind, value }) =>
        project === projectPath && (kind !== "allow" || !workbenchBrowserRule(value)),
    ),
  )
}

function parseRules(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return []
  }
}

function isEntry(value: unknown): value is ProjectPermissionEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "projectPath" in value &&
    typeof value.projectPath === "string" &&
    isAbsolute(value.projectPath) &&
    "value" in value &&
    typeof value.value === "string" &&
    value.value.length > 0 &&
    "kind" in value &&
    (value.kind === "allow" || (value.kind === "directory" && isAbsolute(value.value)))
  )
}
