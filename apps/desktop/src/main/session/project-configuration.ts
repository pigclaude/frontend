// 将当前工作目录与 Git 根之间的项目扩展投影到独立配置根，并在项目文件变化后重新校验来源。

import { createWriteStream, watch, type FSWatcher, type Stats } from "node:fs"
import { mkdir, mkdtemp, open, readdir, rename, rm, stat } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { pipeline } from "node:stream/promises"
import type { StagedPersonalClaudeSkills } from "./personal-claude-skills"
import {
  canonicalProjectPath,
  containsProjectPath,
  isMissingProjectPath,
  resolveProjectConfigurationScope,
} from "./project-configuration-scope"
import { inspectTrustedSettings, type TrustedProjectSettings } from "./trusted-project-settings"

const projectComponents = ["commands", "skills", "agents", "output-styles"] as const
type ProjectBoundary = { root: string; personalDirectory: string }
type SourceFile = { path: string; identity: Stats; destination: string }

/** SDK 使用的配置根和指令排除；dispose 停止监听并清理本次生成的配置文件。 */
export type SessionProjectConfiguration = {
  directory: string | null
  claudeMdExcludes: string[]
  /** 已确认信任时使用实际配置目录及启动时锁定的路由键。 */
  trusted?: TrustedProjectSettings
  /** 已复制到本次会话目录的个人 skills；项目配置与账号仍使用原有隔离。 */
  personalSkills?: StagedPersonalClaudeSkills
  dispose(): Promise<void>
}

/** 为未信任项目生成临时扩展副本；已信任时验证并使用实际项目配置目录。 */
export async function prepareProjectConfiguration(
  workspace: string,
  temporaryDirectory: string,
  userHome?: string,
  trustedDirectory?: string,
): Promise<SessionProjectConfiguration> {
  const scope = await resolveProjectConfigurationScope(workspace, userHome)
  const { directories, claudeMdExcludes, personalDirectory } = scope
  const root = directories.at(-1)
  const current = directories[0]
  if (
    trustedDirectory !== undefined &&
    (current === undefined ||
      relative(trustedDirectory, current) !== "" ||
      relative(trustedDirectory, workspace) !== "")
  )
    throw new Error("已确认信任的项目目录已变更")
  if (root === undefined) return { directory: null, claudeMdExcludes, dispose: async () => {} }
  if (trustedDirectory !== undefined) {
    return {
      directory: trustedDirectory,
      claudeMdExcludes,
      trusted: await inspectTrustedSettings(scope),
      dispose: async () => {},
    }
  }

  const directory = await mkdtemp(join(temporaryDirectory, "project-"))
  const config = join(directory, ".claude")
  const stagingFile = join(directory, "pending-copy")
  const boundary = { root, personalDirectory }
  const activeFiles = new Map<string, SourceFile>()
  const watchers = new Map<string, { watcher: FSWatcher; recursive: boolean }>()
  let pending = Promise.resolve()
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = false
  let disposing: Promise<void> | undefined

  const schedule = (): void => {
    if (closed) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      pending = pending.then(refresh).catch(() => undefined)
    }, 80)
    timer.unref()
  }
  const observe = (path: string, scopedChildren: boolean): void => {
    if (closed || watchers.has(path)) return
    if ([...watchers].some(([root, item]) => item.recursive && containsProjectPath(root, path)))
      return
    try {
      const watcher = watch(
        path,
        { persistent: false, recursive: scopedChildren },
        (_event, file) => {
          if (scopedChildren || file === ".claude" || file === null) schedule()
        },
      )
      watchers.set(path, { watcher, recursive: scopedChildren })
      watcher.on("error", () => {
        watchers.delete(path)
        watcher.close()
      })
    } catch {
      // 监听不可用时仍可使用最近一次成功读取的项目配置。
    }
  }
  const refresh = async (): Promise<void> => {
    if (closed) return
    const sources = new Map<string, SourceFile>()
    const skills = new Set<string>()
    for (const ancestor of directories) {
      observe(ancestor, false)
      const projectConfig = await safePath(join(ancestor, ".claude"), boundary)
      if (projectConfig && (await optionalStat(projectConfig))?.isDirectory())
        observe(projectConfig, true)
      for (const component of projectComponents) {
        const source = await safePath(join(ancestor, ".claude", component), boundary)
        if (source === null || !(await optionalStat(source))?.isDirectory()) continue
        if (component !== "skills") {
          await collect(source, component, boundary, sources, observe, new Set(), true)
          continue
        }
        observe(source, true)
        for (const name of await entries(source)) {
          const skill = await safePath(join(source, name), boundary)
          const key = fileKey(name)
          if (skill === null || skills.has(key) || !(await optionalStat(skill))?.isDirectory())
            continue
          const definition = await safePath(join(skill, "SKILL.md"), boundary)
          if (definition === null || !(await optionalStat(definition))?.isFile()) continue
          await collect(skill, join(component, name), boundary, sources, observe)
          skills.add(key)
        }
      }
    }
    for (const [key, file] of activeFiles) {
      if (sources.has(key)) continue
      await rm(join(config, file.destination), { force: true })
      activeFiles.delete(key)
    }
    for (const [key, source] of sources) {
      const previous = activeFiles.get(key)
      if (previous?.path === source.path && sameFileVersion(previous.identity, source.identity))
        continue
      const destination = join(config, source.destination)
      if (await replaceFile(source, destination, stagingFile)) activeFiles.set(key, source)
    }
  }
  const dispose = (): Promise<void> => {
    if (disposing !== undefined) return disposing
    closed = true
    clearTimeout(timer)
    for (const { watcher } of watchers.values()) watcher.close()
    watchers.clear()
    disposing = pending.then(() => rm(directory, { recursive: true, force: true }))
    return disposing
  }
  try {
    await mkdir(config, { mode: 0o700 })
    pending = refresh()
    await pending
    return { directory, claudeMdExcludes, dispose }
  } catch (error) {
    pending = pending.catch(() => undefined)
    await dispose().catch(() => undefined)
    throw error
  }
}

async function collect(
  directory: string,
  prefix: string,
  boundary: ProjectBoundary,
  files: Map<string, SourceFile>,
  observe: (path: string, recursive: boolean) => void,
  visited: ReadonlySet<string> = new Set(),
  markdownOnly = false,
): Promise<void> {
  if (visited.has(directory)) return
  const next = new Set([...visited, directory])
  observe(directory, true)
  for (const name of await entries(directory)) {
    if (name === ".git" || name === "node_modules") continue
    const path = await safePath(join(directory, name), boundary)
    if (path === null) continue
    const identity = await optionalStat(path)
    const destination = join(prefix, name)
    if (identity?.isDirectory()) {
      await collect(path, destination, boundary, files, observe, next, markdownOnly)
    } else if (
      identity?.isFile() &&
      (!markdownOnly || name.endsWith(".md")) &&
      !files.has(fileKey(destination))
    ) {
      files.set(fileKey(destination), { path, identity, destination })
    }
  }
}

async function safePath(path: string, boundary: ProjectBoundary): Promise<string | null> {
  const resolved = await canonicalProjectPath(path)
  return resolved !== null &&
    resolved !== boundary.root &&
    containsProjectPath(boundary.root, resolved) &&
    !containsProjectPath(boundary.personalDirectory, resolved)
    ? resolved
    : null
}

async function entries(directory: string): Promise<string[]> {
  try {
    return await readdir(directory)
  } catch (error) {
    if (isMissingProjectPath(error)) return []
    throw error
  }
}

async function optionalStat(path: string): Promise<Stats | null> {
  try {
    return await stat(path)
  } catch (error) {
    if (isMissingProjectPath(error)) return null
    throw error
  }
}

function fileKey(name: string): string {
  return process.platform === "win32" ? name.toLowerCase() : name
}

function sameFileVersion(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.mtimeMs === b.mtimeMs && a.size === b.size
}

async function replaceFile(
  source: SourceFile,
  destination: string,
  stagingFile: string,
): Promise<boolean> {
  try {
    const file = await open(source.path, "r")
    try {
      const current = await file.stat()
      if (!current.isFile() || !sameFileVersion(current, source.identity)) return false
      await pipeline(file.createReadStream(), createWriteStream(stagingFile, { mode: 0o600 }))
    } finally {
      await file.close()
    }
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
    await rename(stagingFile, destination)
    return true
  } catch (error) {
    if (isMissingProjectPath(error)) return false
    throw error
  }
}
