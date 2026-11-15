// 在同一目录原子发布插件副本和安装记录，卸载先撤下记录再清理文件。

import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { z } from "zod"
import {
  capabilityPluginManifestFile,
  type InstalledCapabilityPlugin,
} from "../../capability-plugin-contract"
import type { CapabilityPluginBundle } from "./capability-plugin-bundle"
import { parseCapabilityPluginManifest } from "./capability-plugin-manifest"
import { capabilityPluginStoragePaths, isCapabilityPluginId } from "./capability-plugin-paths"

/** 持久安装元数据；兼容性从当前应用版本计算，不写入记录。 */
export type CapabilityPluginRecord = Omit<InstalledCapabilityPlugin, "compatible">

const sha256 = /^[0-9a-f]{64}$/
const saved = z.strictObject({
  type: z.literal("capability"),
  manifest: z.unknown(),
  revision: z.uuid(),
  installedAt: z.iso.datetime(),
  sourceKind: z.enum(["directory", "archive"]),
  sha256: z.string().regex(sha256).nullable(),
  approvedDomains: z.array(z.string()).max(32),
  enabled: z.boolean(),
})
const removal = z.strictObject({ keepData: z.boolean() })

/** 已安装、待清理和数据目录都位于独立插件根。 */
export class CapabilityPluginRecords {
  readonly #installed: string
  readonly #withdrawn: string

  /** 在插件根下定位改动，不触碰应用其他数据。 */
  constructor(private readonly root: string) {
    this.#installed = join(root, "installed")
    this.#withdrawn = join(root, "removing")
  }

  /** 列出实际已经发布的插件目录。 */
  listIds(): Promise<string[]> {
    return listDirectories(this.#installed)
  }

  /** 列出上次卸载后仍需清理的目录。 */
  removingIds(): Promise<string[]> {
    return listDirectories(this.#withdrawn)
  }

  /** 读取合法安装记录，目录撤下后返回空值。 */
  async read(id: string): Promise<CapabilityPluginRecord | null> {
    const json = await readJson(join(this.#installed, id, "record.json"))
    if (json === undefined) return null
    try {
      const record = saved.parse(json)
      const manifest = parseCapabilityPluginManifest(record.manifest)
      if (
        manifest.id !== id ||
        JSON.stringify(record.approvedDomains) !== JSON.stringify(manifest.networkDomains) ||
        (record.sourceKind === "archive") !== (record.sha256 !== null)
      )
        throw new Error("PLUGIN_RECORD_INVALID")
      return { ...record, manifest }
    } catch {
      throw new Error("PLUGIN_RECORD_INVALID")
    }
  }

  /** 已发布的私有包根，只加载管理器写入的模块副本。 */
  packageDirectory(id: string): string {
    return join(this.#installed, id, "package")
  }

  /** 在私有暂存目录写完整副本，再一次性发布副本和记录。 */
  async install(
    record: CapabilityPluginRecord,
    bundle: CapabilityPluginBundle,
    beforePublish: () => void,
  ): Promise<void> {
    await mkdir(this.#installed, { recursive: true, mode: 0o700 })
    const stage = await mkdtemp(join(this.#installed, ".staging-"))
    try {
      const directory = join(stage, "package")
      await mkdir(directory, { mode: 0o700 })
      await writeFile(
        join(directory, capabilityPluginManifestFile),
        JSON.stringify(bundle.manifest),
        {
          flag: "wx",
          mode: 0o600,
        },
      )
      for (const [name, source] of Object.entries(bundle.modules)) {
        const file = join(directory, name)
        await mkdir(dirname(file), { recursive: true, mode: 0o700 })
        await writeFile(file, source, { flag: "wx", mode: 0o600 })
      }
      await writeFile(join(stage, "record.json"), JSON.stringify(record), {
        flag: "wx",
        mode: 0o600,
      })
      beforePublish()
      await rename(stage, join(this.#installed, record.manifest.id))
    } finally {
      await rm(stage, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /** 原子替换启停元数据，版本和确认的域名保持原绑定。 */
  setRecord(record: CapabilityPluginRecord, beforePublish?: () => void): Promise<void> {
    return atomicJson(
      join(this.#installed, record.manifest.id, "record.json"),
      record,
      beforePublish,
    )
  }

  /** 撤下插件，使后续调用无法再读取旧记录。 */
  async withdraw(id: string, keepData: boolean): Promise<void> {
    const directory = join(this.#installed, id)
    await mkdir(this.#withdrawn, { recursive: true, mode: 0o700 })
    await atomicJson(join(directory, "removal.json"), { keepData })
    await rename(directory, join(this.#withdrawn, id))
  }

  /** 读取落盘的卸载选项，重启清理不会误删用户选择保留的数据。 */
  async removalPlan(id: string): Promise<{ keepData: boolean } | null> {
    const json = await readJson(join(this.#withdrawn, id, "removal.json"))
    if (json === undefined) return null
    const parsed = removal.safeParse(json)
    if (!parsed.success) throw new Error("PLUGIN_RECORD_INVALID")
    return parsed.data
  }

  /** 实例停止后清理密钥、可选的数据及已撤下的副本。 */
  async cleanRemoval(id: string, keepData: boolean): Promise<void> {
    const { dataDirectory, secretsFile } = capabilityPluginStoragePaths(this.root, id)
    await rm(dirname(secretsFile), { recursive: true, force: true })
    if (!keepData) await rm(dataDirectory, { recursive: true, force: true })
    await rm(join(this.#withdrawn, id), { recursive: true, force: true })
  }
}

async function listDirectories(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && isCapabilityPluginId(entry.name))
      .map(({ name }) => name)
      .sort()
  } catch (error: unknown) {
    if (missing(error)) return []
    throw error
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown
  } catch (error: unknown) {
    if (missing(error)) return undefined
    throw new Error("PLUGIN_RECORD_INVALID")
  }
}

async function atomicJson(path: string, value: object, beforePublish?: () => void): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 })
    beforePublish?.()
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
