// 在同一目录原子发布插件副本和安装记录，卸载先撤下记录再清理文件。

import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { z } from "zod"
import {
  capabilityPluginManifestFile,
  type InstalledCapabilityPlugin,
  type InstalledClaudeCodePlugin,
} from "../../capability-plugin-contract"
import {
  readCapabilityPluginDirectory,
  validateCapabilityPluginBundle,
} from "./capability-plugin-bundle"
import { parseCapabilityPluginManifest } from "./capability-plugin-manifest"
import { capabilityPluginStoragePaths, isCapabilityPluginId } from "./capability-plugin-paths"
import type { CapabilityPluginSnapshot } from "./capability-plugin-snapshot"
import {
  readClaudeCodePluginDirectory,
  synthesizeClaudeCodePlugin,
} from "./claude-code-plugin-bundle"
import { pluginBundleFilesDigest, type DesktopPluginBundle } from "./desktop-plugin-bundle"
import type { PluginMarketplaceProvenance } from "./plugin-marketplace-catalog"

type PublishedPackage = {
  packageRevision?: true | undefined
  marketplace?: PluginMarketplaceProvenance | undefined
}

/** 持久安装元数据；兼容性从当前应用版本计算，不写入记录。 */
export type CapabilityPluginRecord = Omit<InstalledCapabilityPlugin, "compatible"> &
  PublishedPackage

/** Claude Code 每次启动只使用和已确认文件表摘要一致的合成副本。 */
export type ClaudeCodePluginRecord = Omit<InstalledClaudeCodePlugin, "compatible"> &
  PublishedPackage & {
    packageDigest: string
    menuCommands: string[]
    executionClaims?: Readonly<Record<string, readonly string[]>> | undefined
  }

/** 包类型决定记录可以发布到 Worker 还是 Claude SDK。 */
export type DesktopPluginRecord = CapabilityPluginRecord | ClaudeCodePluginRecord

const sha256 = /^[0-9a-f]{64}$/
const marketProvenance = z.strictObject({
  sourceId: z.string().min(1).max(128),
  entryId: z.string().min(1).max(128),
  digest: z.string().regex(sha256),
  artifactDigest: z.string().regex(sha256).optional(),
  archiveSha256: z.string().regex(sha256).nullable(),
  repo: z.string().nullable(),
  commit: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .nullable(),
})
const installedFields = {
  revision: z.uuid(),
  installedAt: z.iso.datetime(),
  sourceKind: z.enum(["directory", "archive"]),
  sha256: z.string().regex(sha256).nullable(),
  enabled: z.boolean(),
  revocationReason: z.string().min(1).optional(),
  packageRevision: z.literal(true).optional(),
  marketplace: marketProvenance.optional(),
}
const savedCapability = z.strictObject({
  ...installedFields,
  type: z.literal("capability"),
  manifest: z.unknown(),
  approvedDomains: z.array(z.string()).max(32),
  toolApproval: z.enum(["always_ask", "follow_session"]).default("always_ask"),
})
const savedClaudeCode = z.strictObject({
  ...installedFields,
  type: z.literal("claude-code"),
  packageDigest: z.string().regex(sha256),
  menuCommands: z.array(z.string()),
  executionClaims: z.record(z.string(), z.array(z.string().regex(sha256))).optional(),
  manifest: z.strictObject({
    id: z.string().refine(isCapabilityPluginId),
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().optional(),
    commands: z.array(z.string()),
    skills: z.array(z.string()),
    agents: z.array(z.string()),
    ignoredComponents: z.array(z.enum(["hooks", "mcp", "lsp"])),
    skillExecution: z.array(
      z.strictObject({
        name: z.string(),
        inline: z.boolean(),
        hooks: z.boolean(),
        allowedTools: z.boolean(),
      }),
    ),
  }),
})
const saved = z.discriminatedUnion("type", [savedCapability, savedClaudeCode])
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
  async read(id: string): Promise<DesktopPluginRecord | null> {
    const json = await readJson(join(this.#installed, id, "record.json"))
    if (json === undefined) return null
    try {
      const record = saved.parse(json)
      if ((record.sourceKind === "archive") !== (record.sha256 !== null))
        throw new Error("PLUGIN_RECORD_INVALID")
      if (record.type === "claude-code") {
        if (record.manifest.id !== id) throw new Error("PLUGIN_RECORD_INVALID")
        return record
      }
      const manifest = parseCapabilityPluginManifest(record.manifest)
      if (
        manifest.id !== id ||
        JSON.stringify(record.approvedDomains) !== JSON.stringify(manifest.networkDomains)
      )
        throw new Error("PLUGIN_RECORD_INVALID")
      return { ...record, manifest }
    } catch {
      throw new Error("PLUGIN_RECORD_INVALID")
    }
  }

  /** 列出有效安装记录，单个损坏记录不阻止其余插件使用。 */
  async list(): Promise<DesktopPluginRecord[]> {
    const records = await Promise.all(
      (await this.listIds()).map((id) => this.read(id).catch(() => null)),
    )
    return records.filter((record) => record !== null)
  }

  /** 从记录绑定的私有模块副本建立当前版本沙箱所需的数据。 */
  async snapshot(
    record: CapabilityPluginRecord,
    appVersion: string,
  ): Promise<CapabilityPluginSnapshot> {
    const files = await readCapabilityPluginDirectory(this.packageDirectory(record))
    const { manifest, modules } = validateCapabilityPluginBundle(files, appVersion)
    if (JSON.stringify(manifest) !== JSON.stringify(record.manifest))
      throw new Error("PLUGIN_RECORD_INVALID")
    return {
      manifest,
      modules,
      revision: record.revision,
      approvedDomains: record.approvedDomains,
      toolApproval: record.toolApproval,
      ...capabilityPluginStoragePaths(this.root, manifest.id),
    }
  }

  /** 已发布的私有包根，只加载管理器写入的模块副本。 */
  packageDirectory(record: DesktopPluginRecord): string {
    const path = join(this.#installed, record.manifest.id)
    return record.packageRevision ? join(path, "revisions", record.revision) : join(path, "package")
  }

  /** 在私有暂存目录写完整副本，再一次性发布副本和记录。 */
  async install(
    record: DesktopPluginRecord,
    bundle: DesktopPluginBundle,
    beforePublish: () => void,
  ): Promise<void> {
    await mkdir(this.#installed, { recursive: true, mode: 0o700 })
    const stage = await mkdtemp(join(this.#installed, ".staging-"))
    try {
      const directory = join(stage, "package")
      await mkdir(directory, { mode: 0o700 })
      await writePluginFiles(directory, packageFiles(bundle))
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

  /** 先将新包写入独立修订，再通过单次记录替换切到新包。 */
  async replace(
    previous: DesktopPluginRecord,
    next: DesktopPluginRecord & { packageRevision: true },
    bundle: DesktopPluginBundle,
    beforePublish: () => void,
  ): Promise<void> {
    const directory = this.packageDirectory(next)
    await mkdir(dirname(directory), { recursive: true, mode: 0o700 })
    await mkdir(directory, { mode: 0o700 })
    try {
      await writePluginFiles(directory, packageFiles(bundle))
      await this.setRecord(next, beforePublish)
    } catch (error) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
    await rm(this.packageDirectory(previous), { recursive: true, force: true }).catch(
      () => undefined,
    )
  }

  /** 为当次 SDK 进程重建已安装插件，净化后发布独立的会话副本。 */
  async stageClaudeCodePlugin(record: ClaudeCodePluginRecord, directory: string): Promise<string> {
    const { id } = record.manifest
    const installed = await readClaudeCodePluginDirectory(this.packageDirectory(record))
    const { manifest, files } = synthesizeClaudeCodePlugin(installed, id)
    if (manifest.id !== id || pluginBundleFilesDigest(files) !== record.packageDigest)
      throw new Error("PLUGIN_RECORD_INVALID")
    const destination = join(directory, id)
    await mkdir(destination, { mode: 0o700 })
    await writePluginFiles(destination, files)
    return destination
  }

  /** 原子替换启停与询问偏好，版本和确认的域名保持原绑定。 */
  setRecord(record: DesktopPluginRecord, beforePublish?: () => void): Promise<void> {
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

function packageFiles(bundle: DesktopPluginBundle): Iterable<readonly [string, string | Buffer]> {
  return bundle.type === "claude-code"
    ? bundle.files
    : [
        [capabilityPluginManifestFile, JSON.stringify(bundle.manifest)],
        ...Object.entries(bundle.modules),
      ]
}

async function writePluginFiles(
  directory: string,
  files: Iterable<readonly [string, string | Buffer]>,
): Promise<void> {
  for (const [name, source] of files) {
    const file = join(directory, name)
    await mkdir(dirname(file), { recursive: true, mode: 0o700 })
    await writeFile(file, source, { flag: "wx", mode: 0o600 })
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

/** 读取本机插件 JSON，缺文件返回 undefined。 */
export async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown
  } catch (error: unknown) {
    if (missing(error)) return undefined
    throw new Error("PLUGIN_RECORD_INVALID")
  }
}

/** 写入临时文件后原子替换现有的本机插件 JSON。 */
export async function atomicJson(
  path: string,
  value: object,
  beforePublish?: () => void,
): Promise<void> {
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
