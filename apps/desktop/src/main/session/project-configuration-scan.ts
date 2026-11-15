// 按会话的项目范围读取配置，用脱敏报告和本机指纹支持确认，不执行任何项目代码。
import { createHash } from "node:crypto"
import { lstat, open, readdir, realpath, stat } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import type { ProjectConfigurationReport } from "../../project-configuration-contract"
import { scanProjectCommands } from "./project-command-catalog"
import { describeProjectConfiguration, type ReportFile } from "./project-configuration-report"
import {
  canonicalProjectPath,
  containsProjectPath,
  isMissingProjectPath,
  resolveProjectConfigurationScope,
} from "./project-configuration-scope"

const maxReportFileBytes = 512 * 1024
type ReportScope = { root: string; personalDirectory: string }

/** 指纹只在主进程比较两次读取，原始设置和环境变量的值不会离开主进程。 */
export type ProjectConfigurationScan = { report: ProjectConfigurationReport; fingerprint: string }

/** 读取当前真实工作目录的项目配置和可执行项；个人配置目录只显示禁止信任。 */
export async function scanProjectConfiguration(
  path: string,
  isTrusted: (realPath: string) => Promise<boolean>,
  userHome?: string,
): Promise<ProjectConfigurationScan> {
  const workspace = await realpath(path)
  const { directories, personalDirectory } = await resolveProjectConfigurationScope(
    workspace,
    userHome,
  )
  const root = directories.at(-1)
  if (root === undefined) {
    return {
      report: describeProjectConfiguration({
        workspace,
        trust: "blocked",
        instructions: [],
        commands: [],
        agentCount: 0,
        settings: [],
        mcp: [],
        skills: [],
      }),
      fingerprint: "",
    }
  }

  const scope = { root, personalDirectory }
  const cwdDisplay = (file: string) => relative(workspace, file).split(sep).join("/")
  const read = (file: string) => readOptional(file, cwdDisplay(file), scope)
  const commands = await scanProjectCommands(workspace)
  const settings = await filesOf(
    directories.flatMap((directory) => [
      join(directory, ".claude", "settings.json"),
      join(directory, ".claude", "settings.local.json"),
    ]),
    read,
  )
  const mcp = await filesOf(
    directories.map((directory) => join(directory, ".mcp.json")),
    read,
  )
  const skills = await Promise.all(
    commands
      .filter((item) => item.kind === "skill")
      .map(async ({ name, file }) => {
        const content = await read(file)
        return { name, path: cwdDisplay(file), text: content?.text ?? null }
      }),
  )
  const instructions = await instructionPaths(directories, scope)
  const report = describeProjectConfiguration({
    workspace,
    trust: (await isTrusted(workspace)) ? "trusted" : "untrusted",
    instructions: instructions.map(cwdDisplay),
    commands,
    agentCount: await countAgents(directories, scope),
    settings,
    mcp,
    skills,
  })
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ report, settings, mcp, skills }))
    .digest("hex")
  return { report, fingerprint }
}

async function filesOf(
  paths: readonly string[],
  read: (path: string) => Promise<ReportFile | null>,
): Promise<ReportFile[]> {
  return (await Promise.all(paths.map(read))).filter((file) => file !== null)
}

async function readOptional(
  path: string,
  display: string,
  scope: ReportScope,
): Promise<ReportFile | null> {
  try {
    await lstat(path)
  } catch (error) {
    return isMissingProjectPath(error) ? null : { path: display, text: null }
  }
  try {
    const canonical = await scopedPath(path, scope)
    if (canonical === null) return { path: display, text: null }
    const expected = await stat(canonical)
    if (!expected.isFile() || expected.size > maxReportFileBytes)
      return { path: display, text: null }
    const file = await open(canonical, "r")
    try {
      const info = await file.stat()
      if (
        !info.isFile() ||
        info.size > maxReportFileBytes ||
        info.ino !== expected.ino ||
        info.dev !== expected.dev
      ) {
        return { path: display, text: null }
      }
      const buffer = Buffer.alloc(info.size + 1)
      let length = 0
      while (length < buffer.length) {
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, length)
        if (bytesRead === 0) break
        length += bytesRead
      }
      return {
        path: display,
        text: length === buffer.length ? null : buffer.toString("utf8", 0, length),
      }
    } finally {
      await file.close()
    }
  } catch {
    return { path: display, text: null }
  }
}

async function instructionPaths(directories: string[], scope: ReportScope): Promise<string[]> {
  const paths: string[] = []
  for (const directory of directories) {
    for (const base of [directory, join(directory, ".claude")]) {
      for (const name of ["CLAUDE.md", "AGENTS.md"]) {
        const path = join(base, name)
        const canonical = await scopedPath(path, scope)
        if (canonical && (await stat(canonical)).isFile()) {
          paths.push(path)
          break
        }
      }
    }
  }
  return paths
}

async function countAgents(directories: readonly string[], scope: ReportScope): Promise<number> {
  const agents = new Set<string>()
  async function scan(path: string, names: string[], parents: ReadonlySet<string>): Promise<void> {
    const canonical = await scopedPath(path, scope)
    if (canonical === null || parents.has(canonical)) return
    try {
      const nested = new Set([...parents, canonical])
      for (const entry of await readdir(canonical)) {
        if (entry === ".git" || entry === "node_modules") continue
        const file = await scopedPath(join(canonical, entry), scope)
        if (file === null) continue
        const info = await stat(file)
        if (info.isDirectory()) await scan(file, [...names, entry], nested)
        else if (info.isFile() && entry.endsWith(".md")) agents.add([...names, entry].join("/"))
      }
    } catch (error) {
      if (!isMissingProjectPath(error)) throw error
    }
  }
  for (const directory of directories)
    await scan(join(directory, ".claude", "agents"), [], new Set())
  return agents.size
}

async function scopedPath(
  path: string,
  { root, personalDirectory }: ReportScope,
): Promise<string | null> {
  const canonical = await canonicalProjectPath(path)
  return canonical &&
    canonical !== root &&
    containsProjectPath(root, canonical) &&
    !containsProjectPath(personalDirectory, canonical)
    ? canonical
    : null
}
