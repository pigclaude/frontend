// 将本机包合成为 Claude Code 仅加载提示类组件的副本。

import { posix } from "node:path"
import type {
  ClaudeCodePluginManifest,
  ClaudeCodePluginSkillExecution,
} from "../../capability-plugin-contract"
import { readClaudeMarkdown, skillExecutionOf } from "../session/claude-markdown"
import {
  claudeCodePluginManifestFile,
  isPluginHookFile,
  readClaudeCodePluginManifest,
  type ClaudeCodeCommand,
  type ClaudeCodePluginSource,
} from "./claude-code-plugin-manifest"
import { validateClaudeCodePluginFiles } from "./claude-code-plugin-source"

/** 读出开发目录的普通文件，用于安装前的同一次快照。 */
export { readClaudeCodePluginDirectory } from "./claude-code-plugin-source"

/** 私有合成目录的完整文件表，以及同一份内容的安装披露。 */
export type ClaudeCodePluginBundle = {
  manifest: ClaudeCodePluginManifest
  files: ReadonlyMap<string, Buffer>
}

type PluginFiles = ReadonlyMap<string, Buffer>
type ReadMarkdown = ReturnType<typeof readClaudeMarkdown>
type AddFile = (path: string, contents: Buffer) => void
type Execution = ReturnType<typeof skillExecutionOf>
type DiscloseExecution = (name: string, markdown: ReadMarkdown, allowedTools?: boolean) => void

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
const privateSegments = new Set([".claude-plugin", ".git", "node_modules"])
const nonSkillRoots = new Set([
  "agents",
  "bin",
  "commands",
  "hooks",
  "monitors",
  "output-styles",
  "skills",
  "themes",
  "workflows",
])
const namePattern = /^[\p{L}\p{N}][\p{L}\p{N}_.:-]{0,127}$/u

/** 合成安全的 Claude Code 插件目录，并返回实际加载组件的元数据。 */
export function synthesizeClaudeCodePlugin(
  files: ReadonlyMap<string, Buffer>,
  fallbackId: string,
): ClaudeCodePluginBundle {
  const original = validateClaudeCodePluginFiles(files)
  const source = readClaudeCodePluginManifest(original, fallbackId)
  const approved = new Map([...original].filter(([path]) => permitted(path, source)))
  const generated = new Map<string, Buffer>()
  const executions = new Map<string, Execution>()
  const addFile: AddFile = (path, contents) => {
    const existing = generated.get(path)
    if (existing && !existing.equals(contents)) throw new Error("PLUGIN_BUNDLE_UNSAFE")
    if (!existing) generated.set(path, Buffer.from(contents))
  }
  const disclose: DiscloseExecution = (name, markdown, allowedTools = false) => {
    const execution = skillExecutionOf(markdown)
    if (!execution.inline && !execution.hooks && !execution.allowedTools && !allowedTools) return
    const existing = executions.get(name)
    executions.set(name, {
      inline: execution.inline || existing?.inline === true,
      hooks: execution.hooks || existing?.hooks === true,
      allowedTools: execution.allowedTools || allowedTools || existing?.allowedTools === true,
    })
  }
  const { names: commandNames, declarations } = commands(source, approved, addFile, disclose)
  const skillNames = skills(source, approved, addFile, disclose)
  const agentNames = agents(source, approved, addFile)
  if (commandNames.length + skillNames.length + agentNames.length === 0) throw invalid()

  const { name, version, description, ignoredComponents } = source
  const metadata = { name, version, ...(description === undefined ? {} : { description }) }
  const manifestBytes = Buffer.from(
    JSON.stringify({
      ...metadata,
      ...(declarations === undefined ? {} : { commands: declarations }),
    }),
  )
  addFile(claudeCodePluginManifestFile, manifestBytes)
  const output = validateClaudeCodePluginFiles(generated)
  readClaudeCodePluginManifest(output, name)
  const execution: ClaudeCodePluginSkillExecution[] = sortedEntries(executions).map(
    ([key, flags]) => ({
      name: qualify(name, key),
      ...flags,
    }),
  )
  return {
    manifest: {
      id: name,
      ...metadata,
      commands: qualifiedNames(name, commandNames),
      skills: qualifiedNames(name, skillNames),
      agents: qualifiedNames(name, agentNames),
      ignoredComponents,
      skillExecution: execution,
    },
    files: new Map(sortedEntries(output)),
  }
}

function commands(
  source: ClaudeCodePluginSource,
  files: PluginFiles,
  addFile: AddFile,
  disclose: DiscloseExecution,
): { names: string[]; declarations?: Record<string, ClaudeCodeCommand> } {
  if (source.commands === undefined) {
    const names: string[] = []
    for (const path of markdownUnder(files, "commands")) {
      const name = withoutExtension(path.slice("commands/".length)).replaceAll("/", ":")
      const contents = requireFile(files, path)
      addFile(path, contents)
      disclose(name, markdown(contents))
      names.push(name)
    }
    return { names }
  }
  const declared = new Map<string, ClaudeCodeCommand>()
  function add(name: string, command: ClaudeCodeCommand): void {
    qualify(source.name, name)
    if (declared.has(name)) throw new Error("PLUGIN_BUNDLE_UNSAFE")
    if (command.source === undefined) {
      disclose(
        name,
        markdown(Buffer.from(command.content ?? "")),
        Boolean(command.allowedTools?.length),
      )
      declared.set(name, command)
      return
    }
    const original = referencePath(command.source)
    if (!original.endsWith(".md")) throw invalid()
    const contents = requireFile(files, original)
    disclose(name, markdown(contents), Boolean(command.allowedTools?.length))
    const target = "commands/" + name.replaceAll(":", "/") + ".md"
    addFile(target, contents)
    declared.set(name, { ...command, source: "./" + target })
  }
  const definitions = source.commands
  if (typeof definitions === "string" || Array.isArray(definitions)) {
    for (const reference of pathList(definitions)) {
      const path = referencePath(reference)
      if (files.has(path)) {
        add(withoutExtension(posix.basename(path)), { source: "./" + path })
      } else {
        const members = markdownUnder(files, path)
        if (members.length === 0) throw invalid()
        for (const child of members) {
          const name = withoutExtension(child.slice(path.length + 1)).replaceAll("/", ":")
          add(name, { source: "./" + child })
        }
      }
    }
  } else {
    for (const name of sorted(Object.keys(definitions))) {
      const command = definitions[name]
      if (command === undefined) throw invalid()
      add(name, command)
    }
  }
  const names = sorted(declared.keys())
  return {
    names,
    declarations: Object.fromEntries(sortedEntries(declared)),
  }
}

function skills(
  source: ClaudeCodePluginSource,
  files: PluginFiles,
  addFile: AddFile,
  disclose: DiscloseExecution,
): string[] {
  const selected = new Map<string, string>()
  function add(folder: string, useFileName: boolean): void {
    const prefix = folder ? folder + "/" : ""
    const info = markdown(requireFile(files, prefix + "SKILL.md"))
    const name = useFileName
      ? documentName(info, folder ? posix.basename(folder) : source.name)
      : posix.basename(folder)
    qualify(source.name, name)
    if (name.includes(":")) throw invalid()
    const earlier = selected.get(name)
    if (earlier === folder) return
    if (earlier !== undefined) throw new Error("PLUGIN_BUNDLE_UNSAFE")
    selected.set(name, folder)
    disclose(name, info)
    for (const [path, contents] of files) {
      if (!path.startsWith(prefix)) continue
      const relative = path.slice(prefix.length)
      if (folder === "" && nonSkillRoots.has(relative.split("/", 1)[0] ?? "")) continue
      addFile("skills/" + name + "/" + relative, contents)
    }
  }
  for (const folder of immediateSkillFolders(files, "skills")) add(folder, false)
  if (
    source.skills === undefined &&
    ![...files.keys()].some((path) => path.startsWith("skills/")) &&
    files.has("SKILL.md")
  ) {
    add("", true)
  }
  for (const reference of pathList(source.skills)) {
    const folder = referencePath(reference, true)
    if (files.has(folder ? folder + "/SKILL.md" : "SKILL.md")) {
      add(folder, true)
    } else {
      const children = immediateSkillFolders(files, folder)
      if (children.length === 0) throw invalid()
      for (const child of children) add(child, false)
    }
  }
  return [...selected.keys()]
}

function agents(source: ClaudeCodePluginSource, files: PluginFiles, addFile: AddFile): string[] {
  const listed =
    source.agents === undefined
      ? markdownUnder(files, "agents")
      : pathList(source.agents).map((path) => referencePath(path))
  const names = new Set<string>()
  for (const path of listed) {
    if (!path.endsWith(".md")) throw invalid()
    const contents = requireFile(files, path)
    const name = documentName(markdown(contents), withoutExtension(posix.basename(path)))
    if (name.includes(":")) throw invalid()
    const nested =
      source.agents === undefined ? path.slice("agents/".length).split("/").slice(0, -1) : []
    const qualified = [...nested, name].join(":")
    qualify(source.name, qualified)
    if (names.has(qualified)) throw new Error("PLUGIN_BUNDLE_UNSAFE")
    names.add(qualified)
    addFile(source.agents === undefined ? path : "agents/" + name + ".md", contents)
  }
  return [...names]
}

function permitted(path: string, source: ClaudeCodePluginSource): boolean {
  const normalized = path.toLowerCase()
  return (
    !normalized.split("/").some((part) => privateSegments.has(part)) &&
    !source.ignoredPaths.has(normalized) &&
    !isPluginHookFile(normalized) &&
    ![".mcp.json", ".lsp.json"].includes(posix.basename(normalized))
  )
}

function immediateSkillFolders(files: PluginFiles, root: string): string[] {
  const prefix = root ? root + "/" : ""
  const folders = sorted(files.keys()).flatMap((path) => {
    if (!path.startsWith(prefix)) return []
    const [folder, name, ...tail] = path.slice(prefix.length).split("/")
    return folder && name === "SKILL.md" && tail.length === 0 ? [prefix + folder] : []
  })
  return folders
}

function markdownUnder(files: PluginFiles, folder: string): string[] {
  return sorted(files.keys()).filter(
    (path) => path.startsWith(folder + "/") && path.endsWith(".md"),
  )
}

function pathList(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function referencePath(value: string, allowRoot = false): string {
  if (allowRoot && (value === "." || value === "./")) return ""
  if (!value.startsWith("./") || value.includes("\\")) throw new Error("PLUGIN_BUNDLE_UNSAFE")
  const path = value.slice(2).replace(/\/$/, "").normalize("NFC")
  if (path.split("/").some((part) => !part || part === "." || part === ".."))
    throw new Error("PLUGIN_BUNDLE_UNSAFE")
  return path
}

function documentName(info: ReadMarkdown, fallback: string): string {
  return typeof info.frontmatter.name === "string" ? info.frontmatter.name : fallback
}

function withoutExtension(path: string): string {
  return path.slice(0, -3)
}

function qualify(plugin: string, name: string): string {
  const full = plugin + ":" + name
  if (name.split(":").some((part) => !namePattern.test(part)) || !namePattern.test(full))
    throw invalid()
  return full
}

function qualifiedNames(plugin: string, names: readonly string[]): string[] {
  return sorted(new Set(names)).map((name) => qualify(plugin, name))
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort()
}

function sortedEntries<T>(entries: ReadonlyMap<string, T>): [string, T][] {
  return [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

function requireFile(files: PluginFiles, path: string): Buffer {
  const bytes = files.get(path)
  if (bytes === undefined) throw invalid()
  return bytes
}

function markdown(bytes: Buffer): ReadMarkdown {
  try {
    return readClaudeMarkdown(decoder.decode(bytes))
  } catch {
    throw invalid()
  }
}

function invalid(): Error {
  return new Error("PLUGIN_BUNDLE_INVALID")
}
