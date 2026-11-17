// 从本机 Claude Code 的个人配置发现可调用的技能，并把技能目录复制到会话专用目录。

import { homedir } from "node:os"
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import { readCanonicalPluginDirectory } from "../plugins/claude-code-plugin-source"
import {
  claudeCodePluginManifestFile,
  readClaudeCodePluginManifest,
} from "../plugins/claude-code-plugin-manifest"
import { readBoundedPluginFile } from "../plugins/plugin-bounded-file"
import { readClaudeMarkdown } from "./claude-markdown"
import { readClaudeSkillInvocation, type ClaudeSkillInvocation } from "./claude-skill-invocations"
import { containsProjectPath } from "./project-configuration-scope"

type PluginName = { name: string; version: string }

/** 个人 skill 的原生名称、目录以及可选的用户级插件身份。 */
export type PersonalClaudeSkill = ClaudeSkillInvocation & { plugin?: PluginName }

/** 本次会话用到的个人技能快照；directory 只含额外目录的 .claude/skills。 */
export type StagedPersonalClaudeSkills = {
  skills: readonly ClaudeSkillInvocation[]
  directory?: string
}

type PersonalConfig = { directory: string; pluginsDirectory?: string }
const configurationLimit = 4 * 1024 * 1024
const skillLimit = 512 * 1024

function configPath(value: string | undefined, fallback: string): string {
  const path = value?.trim()
  if (path === "~") return homedir()
  if (path?.startsWith("~/") || path?.startsWith("~\\")) return join(homedir(), path.slice(2))
  return path ? resolve(path) : fallback
}

function localConfig(): PersonalConfig {
  const directory = configPath(process.env.CLAUDE_CONFIG_DIR, join(homedir(), ".claude"))
  return {
    directory,
    pluginsDirectory: configPath(
      process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR,
      join(directory, "plugins"),
    ),
  }
}

function fields(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    const canonical = await realpath(path)
    return fields(
      JSON.parse((await readBoundedPluginFile(canonical, configurationLimit)).toString("utf8")),
    )
  } catch {
    return {}
  }
}

async function readDirectories(path: string): Promise<string[]> {
  const entries = await readdir(path).catch(() => [])
  return entries.filter((entry) => !entry.startsWith(".")).sort()
}

async function readSkill(
  root: string,
  directory: string,
  plugin?: PluginName,
  declared = false,
): Promise<PersonalClaudeSkill | null> {
  try {
    const path = await realpath(join(directory, "SKILL.md"))
    if (!containsProjectPath(root, path) || basename(path) !== "SKILL.md") return null
    const content = (await readBoundedPluginFile(path, skillLimit)).toString("utf8")
    const header = declared ? readClaudeMarkdown(content).frontmatter["name"] : undefined
    const fallback = directory === root && plugin ? plugin.name : basename(directory)
    const prefix = plugin ? plugin.name + ":" : ""
    const declaredName = typeof header === "string" && header.trim() ? header.trim() : fallback
    const leaf = declaredName.startsWith(prefix) ? declaredName.slice(prefix.length) : declaredName
    if (!/^[a-zA-Z0-9][\w.-]{0,127}$/.test(leaf)) return null
    const invocation = readClaudeSkillInvocation(prefix + leaf, path, content)
    return invocation && { ...invocation, ...(plugin === undefined ? {} : { plugin }) }
  } catch {
    return null
  }
}

async function collectSkills(
  root: string,
  directory: string,
  plugin?: PluginName,
  single = false,
): Promise<PersonalClaudeSkill[]> {
  const canonical = await realpath(directory).catch(() => null)
  if (!canonical || !containsProjectPath(root, canonical)) return []
  if (single) {
    const found = await readSkill(root, directory, plugin, true)
    if (found) return [found]
  }
  const folders = await readDirectories(directory)
  return (
    await Promise.all(folders.map((name) => readSkill(root, join(directory, name), plugin)))
  ).filter((skill) => skill !== null)
}

async function readManifest(root: string) {
  const path = join(root, claudeCodePluginManifestFile)
  const contents = await readBoundedPluginFile(path, 256 * 1024)
  return readClaudeCodePluginManifest(
    new Map([[claudeCodePluginManifestFile, contents]]),
    basename(root),
  )
}

async function pluginSkills(root: string): Promise<PersonalClaudeSkill[]> {
  const manifest = await readManifest(root).catch(() => null)
  if (!manifest) return []
  const plugin = { name: manifest.name, version: manifest.version }
  const found = await collectSkills(root, join(root, "skills"), plugin)
  const declared = typeof manifest.skills === "string" ? [manifest.skills] : (manifest.skills ?? [])
  for (const path of declared) {
    const directory = await realpath(resolve(root, path)).catch(() => null)
    if (directory && containsProjectPath(root, directory))
      found.push(...(await collectSkills(root, directory, plugin, true)))
  }
  if (declared.length === 0 && found.length === 0) {
    const single = await readSkill(root, root, plugin, true)
    if (single) found.push(single)
  }
  return found
}

async function installedPlugins(
  directory: string,
  enabled: Record<string, unknown>,
): Promise<PersonalClaudeSkill[]> {
  const registry = fields((await readJson(join(directory, "installed_plugins.json")))["plugins"])
  const found: PersonalClaudeSkill[] = []
  for (const key of Object.keys(registry).sort()) {
    const records = registry[key]
    if (enabled[key] !== true || !Array.isArray(records)) continue
    for (const value of records) {
      const record = fields(value)
      const path = record["installPath"]
      if (record["scope"] !== "user" || typeof path !== "string" || !isAbsolute(path)) continue
      const root = await realpath(path).catch(() => null)
      if (!root) continue
      found.push(...(await pluginSkills(root)))
      break
    }
  }
  return found
}

// 个人技能目录中显式安装的链接可以指向同一用户管理的独立目录。
async function bareSkills(path: string): Promise<PersonalClaudeSkill[]> {
  const entries = await readDirectories(path)
  const found = await Promise.all(
    entries.map(async (name) => {
      const directory = join(path, name)
      const root = await realpath(directory).catch(() => null)
      return root ? readSkill(root, directory) : null
    }),
  )
  return found.filter((skill) => skill !== null)
}

/** 只读取个人技能目录和已启用的用户级插件，仓库设置不能改变这份目录。 */
export async function discoverPersonalClaudeSkills(
  config: PersonalConfig = localConfig(),
): Promise<PersonalClaudeSkill[]> {
  const settings = await readJson(join(config.directory, "settings.json"))
  const overrides = fields(settings["skillOverrides"])
  const [bare, installed] = await Promise.all([
    bareSkills(join(config.directory, "skills")),
    installedPlugins(
      config.pluginsDirectory ?? join(config.directory, "plugins"),
      fields(settings["enabledPlugins"]),
    ),
  ])
  const byName = new Map<string, PersonalClaudeSkill>()
  for (const skill of [...bare, ...installed]) {
    if (byName.has(skill.name)) continue
    const override = skill.plugin ? undefined : overrides[skill.name]
    if (override === "off") continue
    byName.set(
      skill.name,
      override === "user-invocable-only" ? { ...skill, userInvocationOnly: true } : skill,
    )
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

async function copySkill(
  skill: PersonalClaudeSkill,
  directory: string,
): Promise<ClaudeSkillInvocation | null> {
  try {
    const files = await readCanonicalPluginDirectory(dirname(skill.path))
    const definition = files.get("SKILL.md")
    if (!definition) return null
    const copiedPath = join(directory, "SKILL.md")
    const invocation = readClaudeSkillInvocation(
      skill.name,
      copiedPath,
      definition.toString("utf8"),
    )
    if (!invocation) return null
    for (const [name, bytes] of files) {
      const dst = join(directory, name)
      await mkdir(dirname(dst), { recursive: true, mode: 0o700 })
      await writeFile(dst, bytes, { flag: "wx", mode: 0o600 })
    }
    return {
      ...invocation,
      userInvocationOnly: skill.userInvocationOnly || invocation.userInvocationOnly,
    }
  } catch {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    return null
  }
}

/** 只复制技能目录及资源；已安装在 PigClaude 的同名插件继续占用其原生命名空间。 */
export async function stagePersonalClaudeSkills(
  sources: readonly PersonalClaudeSkill[],
  directory: string,
  existingPlugins: readonly string[],
  projectNames: ReadonlySet<string>,
  enableBare: boolean,
): Promise<StagedPersonalClaudeSkills & { pluginPaths: string[] }> {
  const occupied = new Set(
    (await Promise.all(existingPlugins.map((path) => readManifest(path).catch(() => null)))).map(
      (item) => item?.name,
    ),
  )
  const pluginRoots = new Map<string, string>()
  const skills: ClaudeSkillInvocation[] = []
  let addedDirectory: string | undefined
  for (const skill of sources) {
    if (skill.plugin) {
      const { name, version } = skill.plugin
      if (occupied.has(name)) continue
      const root = pluginRoots.get(name) ?? (await mkdtemp(join(directory, "personal-plugin-")))
      const leaf = skill.name.slice(name.length + 1)
      const invocation = await copySkill(skill, join(root, "skills", leaf))
      if (!invocation) continue
      if (!pluginRoots.has(name)) {
        const manifest = join(root, claudeCodePluginManifestFile)
        await mkdir(dirname(manifest), { recursive: true, mode: 0o700 })
        await writeFile(manifest, JSON.stringify({ name, version }), { flag: "wx", mode: 0o600 })
        pluginRoots.set(name, root)
      }
      skills.push(invocation)
    } else if (enableBare && !projectNames.has(skill.name)) {
      addedDirectory ??= await mkdtemp(join(directory, "personal-skills-"))
      const invocation = await copySkill(
        skill,
        join(addedDirectory, ".claude", "skills", skill.name),
      )
      if (invocation) skills.push(invocation)
    }
  }
  return {
    skills,
    pluginPaths: [...pluginRoots.values()],
    ...(addedDirectory === undefined ? {} : { directory: addedDirectory }),
  }
}
