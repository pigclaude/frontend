// 为一次会话创建只含项目提示类组件的配置根。目录链接保留项目内的文件更新，不引入项目设置或 MCP 配置。

import { copyFile, link, mkdir, mkdtemp, readdir, rm, stat, symlink } from "node:fs/promises"
import { join } from "node:path"
import {
  canonicalProjectPath,
  containsProjectPath,
  resolveProjectConfigurationScope,
} from "./project-configuration-scope"

const projectComponents = ["commands", "skills", "agents", "output-styles"] as const
type ProjectPathBoundary = { root: string; personalDirectory: string }

/** 交给 SDK 的项目配置布局；directory 为空时保持项目加载禁用。 */
export type SessionProjectConfiguration = {
  directory: string | null
  claudeMdExcludes: string[]
}

/** 只读项目扩展，将生成的配置根放进本机会话的临时目录；失败时清理生成的文件。 */
export async function prepareProjectConfiguration(
  workspace: string,
  temporaryDirectory: string,
  userHome?: string,
): Promise<SessionProjectConfiguration> {
  const { directories, claudeMdExcludes, personalDirectory } =
    await resolveProjectConfigurationScope(workspace, userHome)
  const root = directories.at(-1)
  if (root === undefined) return { directory: null, claudeMdExcludes }
  const boundary = { root, personalDirectory }

  const directory = await mkdtemp(join(temporaryDirectory, "project-"))
  try {
    const config = join(directory, ".claude")
    await mkdir(config, { mode: 0o700 })
    for (const component of projectComponents) {
      const sources: string[] = []
      for (const ancestor of directories) {
        const candidate = await projectPath(join(ancestor, ".claude", component), boundary)
        if (candidate && (await stat(candidate)).isDirectory() && !sources.includes(candidate))
          sources.push(candidate)
      }
      await linkProjectComponent(sources, join(config, component), boundary)
    }
    return { directory, claudeMdExcludes }
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

async function linkProjectComponent(
  sources: readonly string[],
  destination: string,
  boundary: ProjectPathBoundary,
): Promise<void> {
  const first = sources[0]
  if (first === undefined) return
  if (sources.length === 1 && (await canLinkDirectory(first, boundary))) {
    await linkDirectory(first, destination)
    return
  }
  await mkdir(destination, { recursive: true, mode: 0o700 })
  const added = new Set<string>()
  for (const source of sources) {
    for (const name of await readdir(source)) {
      const key = process.platform === "win32" ? name.toLowerCase() : name
      if (added.has(key)) continue
      const item = await projectPath(join(source, name), boundary)
      if (item === null) continue
      const target = join(destination, name)
      const info = await stat(item)
      if (info.isDirectory() && (await canLinkDirectory(item, boundary))) {
        await linkDirectory(item, target)
      } else if (info.isFile()) {
        await linkFile(item, target)
      } else {
        continue
      }
      added.add(key)
    }
  }
}

async function canLinkDirectory(
  directory: string,
  boundary: ProjectPathBoundary,
  ancestors: ReadonlySet<string> = new Set(),
): Promise<boolean> {
  if (ancestors.has(directory)) return false
  const checked = new Set([...ancestors, directory])
  const children = await readdir(directory, { withFileTypes: true })
  for (const entry of children) {
    const child = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      const target = await projectPath(child, boundary)
      if (target === null) return false
      const info = await stat(target)
      if (info.isDirectory() && !(await canLinkDirectory(target, boundary, checked))) return false
      if (!info.isDirectory() && !info.isFile()) return false
    } else if (entry.isDirectory()) {
      if (!(await canLinkDirectory(child, boundary, checked))) return false
    } else if (!entry.isFile()) {
      return false
    }
  }
  return true
}

async function projectPath(
  path: string,
  { root, personalDirectory }: ProjectPathBoundary,
): Promise<string | null> {
  const resolved = await canonicalProjectPath(path)
  return resolved !== null &&
    containsProjectPath(root, resolved) &&
    !containsProjectPath(personalDirectory, resolved)
    ? resolved
    : null
}

async function linkDirectory(source: string, destination: string): Promise<void> {
  await symlink(source, destination, process.platform === "win32" ? "junction" : "dir")
}

async function linkFile(source: string, destination: string): Promise<void> {
  if (process.platform !== "win32") {
    await symlink(source, destination)
    return
  }
  try {
    await link(source, destination)
  } catch {
    await copyFile(source, destination)
  }
}
