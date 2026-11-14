// 负责「在外部应用中打开」的应用清单：本机的文件管理器、编辑器和终端，以及用它们打开项目文件夹的命令。
// 编辑器沿用 installed-editors 的登记；这里补上文件管理器和终端，按平台登记候选位置。
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, join, win32 } from "node:path"
import { editorEnv, installedEditors } from "./installed-editors"

/** 应用的类别；清单按文件管理器、编辑器、终端排序。 */
export type OpenAppKind = "file-manager" | "editor" | "terminal"

/** 本机找到的一个应用；location 只在主进程使用，Linux 的文件管理器交给系统，location 为空串。 */
export type InstalledOpenApp = { id: string; name: string; kind: OpenAppKind; location: string }

type AppDef = {
  id: string
  name: string
  kind: Exclude<OpenAppKind, "editor">
  bundles?: string[]
  executables?: string[]
  commands?: string[]
  /** Windows 和 Linux 打开文件夹的参数；不给时直接传文件夹。 */
  args?: (folder: string) => string[]
}

const mac = (name: string): string[] => [
  `/Applications/${name}.app`,
  join(homedir(), "Applications", `${name}.app`),
]

const MAC_FILE_MANAGERS: AppDef[] = [
  {
    id: "finder",
    name: "Finder",
    kind: "file-manager",
    bundles: ["/System/Library/CoreServices/Finder.app"],
  },
]

const MAC_TERMINALS: AppDef[] = [
  {
    id: "terminal",
    name: "Terminal",
    kind: "terminal",
    bundles: ["/System/Applications/Utilities/Terminal.app"],
  },
  { id: "iterm", name: "iTerm", kind: "terminal", bundles: mac("iTerm") },
  { id: "ghostty", name: "Ghostty", kind: "terminal", bundles: mac("Ghostty") },
  { id: "warp", name: "Warp", kind: "terminal", bundles: mac("Warp") },
  { id: "wezterm", name: "WezTerm", kind: "terminal", bundles: mac("WezTerm") },
]

function windowsApps(): { fileManagers: AppDef[]; terminals: AppDef[] } {
  const windir = process.env.WINDIR ?? "C:\\Windows"
  const local = process.env.LOCALAPPDATA ?? ""
  return {
    fileManagers: [
      {
        id: "explorer",
        name: "File Explorer",
        kind: "file-manager",
        executables: [win32.join(windir, "explorer.exe")],
      },
    ],
    terminals: [
      {
        id: "windows-terminal",
        name: "Windows Terminal",
        kind: "terminal",
        executables: local ? [win32.join(local, "Microsoft", "WindowsApps", "wt.exe")] : [],
        args: (folder) => ["-d", folder],
      },
      {
        id: "powershell",
        name: "PowerShell",
        kind: "terminal",
        executables: [
          win32.join(windir, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        ],
        args: (folder) => [
          "-NoExit",
          "-Command",
          `Set-Location -LiteralPath '${folder.replace(/'/g, "''")}'`,
        ],
      },
    ],
  }
}

const LINUX_FILE_MANAGERS: AppDef[] = [{ id: "file-manager", name: "Files", kind: "file-manager" }]

const LINUX_TERMINALS: AppDef[] = [
  {
    id: "gnome-terminal",
    name: "Terminal",
    kind: "terminal",
    commands: ["gnome-terminal"],
    args: (folder) => [`--working-directory=${folder}`],
  },
  {
    id: "konsole",
    name: "Konsole",
    kind: "terminal",
    commands: ["konsole"],
    args: (folder) => ["--workdir", folder],
  },
  {
    id: "ghostty",
    name: "Ghostty",
    kind: "terminal",
    commands: ["ghostty"],
    args: (folder) => [`--working-directory=${folder}`],
  },
  {
    id: "kitty",
    name: "kitty",
    kind: "terminal",
    commands: ["kitty"],
    args: (folder) => ["--directory", folder],
  },
  {
    id: "alacritty",
    name: "Alacritty",
    kind: "terminal",
    commands: ["alacritty"],
    args: (folder) => ["--working-directory", folder],
  },
  {
    id: "wezterm",
    name: "WezTerm",
    kind: "terminal",
    commands: ["wezterm"],
    args: (folder) => ["start", "--cwd", folder],
  },
  {
    id: "xfce4-terminal",
    name: "Xfce Terminal",
    kind: "terminal",
    commands: ["xfce4-terminal"],
    args: (folder) => [`--working-directory=${folder}`],
  },
]

function appDefs(platform: NodeJS.Platform): { fileManagers: AppDef[]; terminals: AppDef[] } {
  if (platform === "darwin") return { fileManagers: MAC_FILE_MANAGERS, terminals: MAC_TERMINALS }
  if (platform === "win32") return windowsApps()
  return { fileManagers: LINUX_FILE_MANAGERS, terminals: LINUX_TERMINALS }
}

function detect(
  defs: readonly AppDef[],
  exists: (path: string) => boolean,
  searchPath: string,
): InstalledOpenApp[] {
  return defs.flatMap((def) => {
    if (!def.bundles && !def.executables && !def.commands) {
      return [{ id: def.id, name: def.name, kind: def.kind, location: "" }]
    }
    const location =
      def.bundles?.find((path) => exists(path)) ??
      def.executables?.find((path) => exists(path)) ??
      def.commands
        ?.map((command) =>
          searchPath
            .split(delimiter)
            .filter(Boolean)
            .map((directory) => join(directory, command))
            .find((candidate) => exists(candidate)),
        )
        .find(Boolean)
    return location ? [{ id: def.id, name: def.name, kind: def.kind, location }] : []
  })
}

/** 检测本机装了的文件管理器、编辑器和终端，按类别和登记顺序返回。 */
export function installedOpenApps(
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = existsSync,
  searchPath = process.env.PATH ?? "",
): InstalledOpenApp[] {
  const { fileManagers, terminals } = appDefs(platform)
  return [
    ...detect(fileManagers, exists, searchPath),
    ...installedEditors(platform, exists, searchPath).map((editor) => ({
      ...editor,
      kind: "editor" as const,
    })),
    ...detect(terminals, exists, searchPath),
  ]
}

/**
 * 用应用打开文件夹的命令。文件管理器返回 null，交给系统打开；
 * macOS 统一用 `open -a`，不依赖 PATH 上的命令行工具。
 */
export function folderLaunch(
  app: InstalledOpenApp,
  folder: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } | null {
  if (app.kind === "file-manager") return null
  if (platform === "darwin") return { command: "open", args: ["-a", app.location, folder] }
  const def = appDefs(platform).terminals.find((item) => item.id === app.id)
  return { command: app.location, args: def?.args?.(folder) ?? [folder] }
}

/** 脱离 PigClaude 启动应用打开文件夹：不等它退出，也不接它的输出；环境同编辑器。启动失败时抛错。 */
export function launchInFolder(command: string, args: string[], folder: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: folder,
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
