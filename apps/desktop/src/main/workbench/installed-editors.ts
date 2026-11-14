// 负责本机编辑器：按平台登记候选位置，检测装了哪些，并用选中的编辑器打开文件。
// macOS 看 .app，Windows 看安装目录，Linux 看 PATH 上的命令。
import { spawn } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, join, win32 } from "node:path"
import { workbenchChildEnv } from "./child-env"

type EditorDef = {
  id: string
  name: string
  bundles?: string[]
  executables?: string[]
  commands?: string[]
}

/** 本机检测到的一个编辑器：登记的 id、显示名和实际找到的位置。 */
export type InstalledEditor = { id: string; name: string; location: string }

const mac = (name: string): string[] => [
  `/Applications/${name}.app`,
  join(homedir(), "Applications", `${name}.app`),
]

const MAC_EDITORS: EditorDef[] = [
  { id: "vscode", name: "VS Code", bundles: mac("Visual Studio Code") },
  {
    id: "vscode-insiders",
    name: "VS Code Insiders",
    bundles: mac("Visual Studio Code - Insiders"),
  },
  { id: "cursor", name: "Cursor", bundles: mac("Cursor") },
  { id: "windsurf", name: "Windsurf", bundles: mac("Windsurf") },
  { id: "trae", name: "Trae", bundles: [...mac("Trae"), ...mac("Trae CN")] },
  { id: "zed", name: "Zed", bundles: mac("Zed") },
  { id: "codebuddy", name: "CodeBuddy", bundles: mac("CodeBuddy") },
  { id: "qoder", name: "Qoder", bundles: mac("Qoder") },
  { id: "kiro", name: "Kiro", bundles: mac("Kiro") },
  { id: "sublime", name: "Sublime Text", bundles: mac("Sublime Text") },
  { id: "xcode", name: "Xcode", bundles: mac("Xcode") },
  {
    id: "idea",
    name: "IntelliJ IDEA",
    bundles: [...mac("IntelliJ IDEA"), ...mac("IntelliJ IDEA CE")],
  },
  { id: "webstorm", name: "WebStorm", bundles: mac("WebStorm") },
  { id: "pycharm", name: "PyCharm", bundles: [...mac("PyCharm"), ...mac("PyCharm CE")] },
  { id: "goland", name: "GoLand", bundles: mac("GoLand") },
]

/** Windows 的常见安装位置：用户级 Programs 与 Program Files。 */
function windowsCandidates(...segments: string[]): string[] {
  const drive = process.env.SystemDrive ?? "C:"
  const local =
    process.env.LOCALAPPDATA ?? win32.join(drive, "Users", "Default", "AppData", "Local")
  return [
    win32.join(local, "Programs", ...segments),
    ...[
      process.env.ProgramFiles,
      process.env["ProgramFiles(x86)"],
      win32.join(drive, "Program Files"),
    ]
      .filter((root): root is string => Boolean(root))
      .map((root) => win32.join(root, ...segments)),
  ]
}

/** JetBrains 的安装目录带版本号，按目录名前缀从新到旧找。 */
function jetbrains(prefix: string, exe: string): string[] {
  return windowsCandidates("JetBrains").flatMap((root) => {
    try {
      return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
        .map((entry) => entry.name)
        .sort()
        .reverse()
        .map((dir) => win32.join(root, dir, "bin", exe))
    } catch {
      return []
    }
  })
}

function windowsEditors(): EditorDef[] {
  return [
    {
      id: "vscode",
      name: "VS Code",
      executables: windowsCandidates("Microsoft VS Code", "Code.exe"),
    },
    {
      id: "vscode-insiders",
      name: "VS Code Insiders",
      executables: windowsCandidates("Microsoft VS Code Insiders", "Code - Insiders.exe"),
    },
    { id: "cursor", name: "Cursor", executables: windowsCandidates("cursor", "Cursor.exe") },
    {
      id: "windsurf",
      name: "Windsurf",
      executables: windowsCandidates("Windsurf", "Windsurf.exe"),
    },
    {
      id: "trae",
      name: "Trae",
      executables: [
        ...windowsCandidates("Trae", "Trae.exe"),
        ...windowsCandidates("Trae CN", "Trae CN.exe"),
      ],
    },
    { id: "zed", name: "Zed", executables: windowsCandidates("Zed", "Zed.exe") },
    {
      id: "codebuddy",
      name: "CodeBuddy",
      executables: windowsCandidates("CodeBuddy", "CodeBuddy.exe"),
    },
    { id: "idea", name: "IntelliJ IDEA", executables: jetbrains("IntelliJ IDEA", "idea64.exe") },
    { id: "webstorm", name: "WebStorm", executables: jetbrains("WebStorm", "webstorm64.exe") },
    { id: "pycharm", name: "PyCharm", executables: jetbrains("PyCharm", "pycharm64.exe") },
  ]
}

const LINUX_EDITORS: EditorDef[] = [
  { id: "vscode", name: "VS Code", commands: ["code"] },
  { id: "vscode-insiders", name: "VS Code Insiders", commands: ["code-insiders"] },
  { id: "cursor", name: "Cursor", commands: ["cursor"] },
  { id: "windsurf", name: "Windsurf", commands: ["windsurf"] },
  { id: "zed", name: "Zed", commands: ["zed", "zeditor"] },
  { id: "sublime", name: "Sublime Text", commands: ["subl"] },
  {
    id: "idea",
    name: "IntelliJ IDEA",
    commands: ["idea", "intellij-idea-ultimate", "intellij-idea-community"],
  },
  { id: "webstorm", name: "WebStorm", commands: ["webstorm"] },
  { id: "pycharm", name: "PyCharm", commands: ["pycharm", "pycharm-community"] },
]

function editorDefs(platform: NodeJS.Platform): EditorDef[] {
  if (platform === "darwin") return MAC_EDITORS
  if (platform === "win32") return windowsEditors()
  return LINUX_EDITORS
}

function findOnPath(
  command: string,
  searchPath: string,
  exists: (path: string) => boolean,
): string | undefined {
  return searchPath
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, command))
    .find((candidate) => exists(candidate))
}

/** 检测本机装了哪些编辑器，按登记顺序返回；位置只在主进程使用。 */
export function installedEditors(
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = existsSync,
  searchPath = process.env.PATH ?? "",
): InstalledEditor[] {
  return editorDefs(platform).flatMap((def) => {
    const location =
      def.bundles?.find((path) => exists(path)) ??
      def.executables?.find((path) => exists(path)) ??
      def.commands?.map((command) => findOnPath(command, searchPath, exists)).find(Boolean)
    return location ? [{ id: def.id, name: def.name, location }] : []
  })
}

/** 用编辑器打开文件的命令；macOS 用 `open -a`，不依赖从 Dock 启动时拿不到的 PATH。 */
export function editorLaunch(
  editor: InstalledEditor,
  file: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "open", args: ["-a", editor.location, file] }
  return { command: editor.location, args: [file] }
}

const graphicalSession = [
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XAUTHORITY",
  "XDG_RUNTIME_DIR",
  "XDG_SESSION_TYPE",
  "XDG_CURRENT_DESKTOP",
  "DBUS_SESSION_BUS_ADDRESS",
]

/** 编辑器的环境：工作台子进程的系统变量，加上 Linux 打开窗口需要的图形会话变量。 */
export function editorEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const environment = workbenchChildEnv(source)
  for (const name of graphicalSession) {
    const value = source[name]
    if (value !== undefined) environment[name] = value
  }
  return environment
}

/** 脱离 PigClaude 启动编辑器打开文件：不等它退出，也不接它的输出；启动失败时抛错。 */
export function launchEditor(editor: InstalledEditor, file: string): Promise<void> {
  const { command, args } = editorLaunch(editor, file)
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: dirname(file),
      env: editorEnv(),
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    })
    child.once("error", reject)
    child.once("spawn", () => {
      child.unref()
      resolve()
    })
  })
}
