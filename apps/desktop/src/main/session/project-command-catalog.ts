// 在主进程枚举指定工作目录范围内的 Claude Code 命令和 skill，不启动会话或执行文件。

import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { readProjectConfigurationFile } from "./project-configuration-file"
import { readClaudeSkillInvocation, type ClaudeSkillInvocation } from "./claude-skill-invocations"
import {
  canonicalProjectPath,
  containsProjectPath,
  isMissingProjectPath,
  resolveProjectConfigurationScope,
  type ProjectConfigurationScope,
} from "./project-configuration-scope"

/** 文件是当前项目范围内的规范路径，只在主进程扫描本地元数据时使用。 */
export type ProjectCommandSource = {
  name: string
  kind: "command" | "skill"
  file: string
}

/** 用完整命名空间区分命令，同名来源选离工作目录最近的文件。 */
export async function scanProjectCommands(workspace: string): Promise<ProjectCommandSource[]> {
  return scanCommands(await resolveProjectConfigurationScope(workspace))
}

/** 读取同一项目范围内的命令和手动可选 skills；只从技能文件中提取必要元数据。 */
export async function scanProjectCommandCatalog(
  workspace: string,
): Promise<{ commands: ProjectCommandSource[]; skills: ClaudeSkillInvocation[] }> {
  const scope = await resolveProjectConfigurationScope(workspace)
  const root = scope.directories.at(-1)
  if (root === undefined) return { commands: [], skills: [] }
  const commands = await scanCommands(scope)
  const metadata = await Promise.all(
    commands
      .filter(({ kind }) => kind === "skill")
      .map(async ({ name, file }) => {
        const source = await readProjectConfigurationFile(file, file, {
          root,
          personalDirectory: scope.personalDirectory,
        })
        return source?.text == null ? null : readClaudeSkillInvocation(name, file, source.text)
      }),
  )
  return { commands, skills: metadata.filter((item) => item !== null) }
}

async function scanCommands({
  directories,
  personalDirectory,
}: ProjectConfigurationScope): Promise<ProjectCommandSource[]> {
  const root = directories.at(-1)
  if (!root) return []
  const find = async (path: string): Promise<string | null> => {
    const real = await canonicalProjectPath(path)
    return real &&
      real !== root &&
      containsProjectPath(root, real) &&
      !containsProjectPath(personalDirectory, real)
      ? real
      : null
  }
  const commands = new Map<string, ProjectCommandSource>()
  const add = (candidate: ProjectCommandSource): void => {
    const key = `${candidate.kind}:${candidate.name}`
    if (!commands.has(key)) commands.set(key, candidate)
  }

  const scanCommandDirectory = async (
    path: string,
    names: string[],
    parents: ReadonlySet<string>,
  ): Promise<void> => {
    const folder = await find(path)
    if (!folder || parents.has(folder) || !(await kind(folder, "directory"))) return
    const visited = new Set([...parents, folder])
    for (const child of await list(folder)) {
      if (child === ".git" || child === "node_modules") continue
      const path = join(folder, child)
      const resolved = await find(path)
      if (resolved === null) continue
      if (await kind(resolved, "directory"))
        await scanCommandDirectory(path, [...names, child], visited)
      else if (child.endsWith(".md") && (await kind(resolved, "file")))
        add({ name: [...names, child.slice(0, -3)].join(":"), kind: "command", file: resolved })
    }
  }

  for (const directory of directories) {
    await scanCommandDirectory(join(directory, ".claude", "commands"), [], new Set())
    const skills = await find(join(directory, ".claude", "skills"))
    if (skills === null || !(await kind(skills, "directory"))) continue
    for (const name of await list(skills)) {
      const file = await find(join(skills, name, "SKILL.md"))
      if (file !== null && (await kind(file, "file"))) add({ name, kind: "skill", file })
    }
  }
  return [...commands.values()].sort((a, b) => a.name.localeCompare(b.name))
}

async function kind(path: string, expected: "directory" | "file"): Promise<boolean> {
  try {
    const info = await stat(path)
    return expected === "directory" ? info.isDirectory() : info.isFile()
  } catch (error) {
    if (isMissingProjectPath(error)) return false
    throw error
  }
}

async function list(directory: string): Promise<string[]> {
  try {
    return await readdir(directory)
  } catch (error) {
    if (isMissingProjectPath(error)) return []
    throw error
  }
}
