// 定义工作台主进程与渲染进程之间的命令和脱敏事件。
import type { PullRequestInfo } from "@pigclaude/ui-contracts"

/** 一层目录及其截断标记，项目内的路径使用斜杠。 */
export type WorkbenchListing = {
  entries: Array<{ name: string; path: string; kind: "file" | "directory" }>
  truncated: boolean
}

/** 搜索结果只返回有界的相对路径与类型。 */
export type WorkbenchSearch = {
  entries: Array<{ path: string; kind: "file" | "directory" }>
  truncated: boolean
}

/** 文件的有界内容和版本；大文件、二进制文件或图片只能预览。 */
export type WorkbenchFile = {
  path: string
  text: string
  truncated: boolean
  binary: boolean
  size: number
  mtimeMs: number
  eol: "lf" | "crlf"
  image?: { mime: string; base64: string } | undefined
}

/** 工作树的稳定目录与分支名称。 */
export type WorkbenchWorktree = { path: string; branch: string | null }

/** 工作台保存的 Git 快照，只暴露展示与选择需要的字段。 */
export type WorkbenchCheckpoint = {
  id: string
  runId: null
  phase: "manual" | "baseline" | "final"
  label: string | null
  createdAt: string
}

/** 内置浏览器在导航时发出的公开状态。 */
export type WorkbenchBrowserPage = {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error?: { code: number; description: string; url: string }
  crashed?: { reason: string }
}

/** 主窗口为内置浏览器报送内容区尺寸。 */
export type WorkbenchBrowserBounds = {
  x: number
  y: number
  width: number
  height: number
  scale: number
}

/** 内置浏览器只接受明确的页面操作。 */
export type WorkbenchBrowserAction = "back" | "forward" | "reload" | "stop" | "devtools"

/** 页面选择器只返回用户选中的元素信息。 */
export type WorkbenchBrowserElement = { selector: string; text: string; url: string }

/** 终端打开后的公开信息，用于展示 shell 名称与工作目录。 */
export type WorkbenchTerminalInfo = { shell: string; cwd: string }

/** 工作台事件按资源 ID 投递，终端内容只来自用户创建的本地 shell。 */
export type WorkbenchEvent =
  | { type: "terminal-data"; id: string; data: string }
  | { type: "terminal-exit"; id: string; exitCode: number }
  | { type: "checkpoints-changed"; id: string }
  | { type: "browser-page"; id: string; page: WorkbenchBrowserPage }
  | { type: "browser-open"; id: string; url: string }
  | { type: "browser-context"; id: string; element: WorkbenchBrowserElement }

/** 渲染进程可使用的工作区能力，文件路径均相对已添加的项目目录。 */
export type WorkbenchBridge = {
  list: (root: string, path: string) => Promise<WorkbenchListing>
  search: (root: string, query: string) => Promise<WorkbenchSearch>
  read: (root: string, path: string) => Promise<WorkbenchFile>
  save: (root: string, path: string, text: string, mtimeMs: number | null) => Promise<WorkbenchFile>
  diff: (root: string, path?: string, checkpointId?: string) => Promise<string>
  worktrees: (root: string) => Promise<WorkbenchWorktree[]>
  createWorktree: (root: string) => Promise<WorkbenchWorktree>
  removeWorktree: (root: string, path: string) => Promise<void>
  checkpoints: (root: string) => Promise<WorkbenchCheckpoint[]>
  capture: (root: string) => Promise<void>
  restore: (root: string, id: string) => Promise<void>
  pullRequest: (root: string) => Promise<PullRequestInfo | null>
  createPullRequest: (
    root: string,
    input: { title: string; body?: string; base?: string },
  ) => Promise<void>
  terminalOpen: (
    root: string,
    id: string,
    cols?: number,
    rows?: number,
  ) => Promise<WorkbenchTerminalInfo>
  terminalWrite: (id: string, data: string) => Promise<void>
  terminalResize: (id: string, cols: number, rows: number) => Promise<void>
  terminalClose: (id: string) => Promise<void>
  browserNavigate: (id: string, url: string) => Promise<void>
  browserCommand: (id: string, action: WorkbenchBrowserAction) => Promise<void>
  browserPresent: (id: string, bounds: WorkbenchBrowserBounds | null) => Promise<void>
  browserPick: (id: string) => Promise<void>
  browserClose: (id: string) => Promise<void>
  browserExternal: (url: string) => Promise<void>
  previewOpen: (url: string) => Promise<{ id: string }>
  subscribe: (listener: (event: WorkbenchEvent) => void) => () => void
}
