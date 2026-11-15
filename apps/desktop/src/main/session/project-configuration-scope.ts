// 从实际工作目录确定项目配置的读取范围，排除 Git 根之上及用户个人目录中的指令。

import { lstat, realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

/** 项目配置来源按离工作目录由近到远排列；为空表示当前工作区禁用项目配置。 */
export type ProjectConfigurationScope = {
  directories: string[]
  claudeMdExcludes: string[]
  personalDirectory: string
}

/** 按实际路径从工作目录向上查找 Git 根；非 Git 目录只读取工作目录本身。 */
export async function resolveProjectConfigurationScope(
  workspace: string,
  userHome = homedir(),
): Promise<ProjectConfigurationScope> {
  const cwd = await realpath(workspace)
  const home = (await canonicalProjectPath(userHome)) ?? resolve(userHome)
  const personalConfig = join(home, ".claude")
  const realPersonalConfig = (await canonicalProjectPath(personalConfig)) ?? personalConfig
  if (
    relative(home, cwd) === "" ||
    containsProjectPath(personalConfig, cwd) ||
    containsProjectPath(realPersonalConfig, cwd)
  ) {
    return {
      directories: [],
      claudeMdExcludes: instructionExclusions([cwd, home]),
      personalDirectory: realPersonalConfig,
    }
  }

  const ancestors = parentDirectories(cwd)
  let projectDepth = 1
  for (const [index, ancestor] of ancestors.entries()) {
    if (relative(home, ancestor) === "") break
    const marker = await optionalGitMarker(join(ancestor, ".git"))
    if (marker) {
      projectDepth = index + 1
      break
    }
  }
  const directories = ancestors.slice(0, projectDepth)
  const claudeMdExcludes = instructionExclusions([...ancestors.slice(projectDepth), home])
  const root = directories.at(-1) ?? cwd
  for (const directory of directories) {
    const rules = join(directory, ".claude", "rules")
    for (const entry of [...instructionFiles(directory), rules]) {
      const resolved = await canonicalProjectPath(entry)
      if (
        resolved &&
        (!containsProjectPath(root, resolved) || containsProjectPath(realPersonalConfig, resolved))
      )
        claudeMdExcludes.push(
          entry === rules ? `${literalPattern(entry)}/**` : literalPattern(entry),
        )
    }
  }
  return { directories, claudeMdExcludes, personalDirectory: realPersonalConfig }
}

/** 含根目录本身的路径范围判断；用 relative 处理不同盘符。 */
export function containsProjectPath(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

/** 取规范路径；缺失或路径中的部件已变为文件时返回 null。 */
export async function canonicalProjectPath(path: string): Promise<string | null> {
  try {
    return await realpath(path)
  } catch (error) {
    if (isMissingProjectPath(error)) return null
    throw error
  }
}

function parentDirectories(start: string): string[] {
  const directories = [start]
  for (let parent = dirname(start); parent !== start; parent = dirname(start)) {
    directories.push(parent)
    start = parent
  }
  return directories
}

async function optionalGitMarker(path: string): Promise<boolean> {
  try {
    const marker = await lstat(path)
    return marker.isDirectory() || marker.isFile()
  } catch (error) {
    if (isMissingProjectPath(error)) return false
    throw error
  }
}

function instructionExclusions(directories: readonly string[]): string[] {
  return [...new Set(directories)].flatMap((directory) => [
    ...instructionFiles(directory).map(literalPattern),
    `${literalPattern(join(directory, ".claude", "rules"))}/**`,
  ])
}

function instructionFiles(directory: string): string[] {
  return [
    join(directory, "CLAUDE.md"),
    join(directory, ".claude", "CLAUDE.md"),
    join(directory, "CLAUDE.local.md"),
    join(directory, "AGENTS.md"),
    join(directory, ".claude", "AGENTS.md"),
  ]
}

function literalPattern(path: string): string {
  return path
    .split(sep)
    .join("/")
    .replace(/[\\*?{}[\]()!+@]/g, "\\$&")
}

/** 项目扩展可选，扫描中消失的路径及循环链接都视为不存在。 */
export function isMissingProjectPath(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR" || error.code === "ELOOP")
  )
}
