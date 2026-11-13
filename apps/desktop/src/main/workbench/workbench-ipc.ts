// 注册工作台命令，绑定已选择的项目、会员状态和可信的主窗口。
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { WorkbenchBrowserAction } from "../../workbench-contract"
import { WorkbenchBrowsers } from "./browser-surface"
import { browserSessionTools } from "./browser-tools"
import {
  captureWorkbenchCheckpoint,
  listWorkbenchCheckpoints,
  resolveWorkbenchCheckpoint,
  restoreWorkbenchCheckpoint,
} from "./git-checkpoints"
import {
  createWorkbenchPullRequest,
  createWorkbenchWorktree,
  listWorkbenchWorktrees,
  readWorkbenchPullRequest,
  removeWorkbenchWorktree,
  workbenchDiff,
} from "./git-workspace"
import { WorkbenchTerminals } from "./terminal-service"
import {
  listWorkbenchDirectory,
  readWorkbenchFile,
  saveWorkbenchFile,
  searchWorkbenchFiles,
} from "./workspace-files"
import { workspaceDirectory } from "./workspace-path"

/** 工作台依赖由桌面组合根提供，项目和会员数据始终以主进程为准。 */
export type WorkbenchIpcOptions = {
  isTrusted: (event: IpcMainInvokeEvent) => boolean
  membership: () => MembershipView | undefined
  roots: () => Promise<string[]>
  hasActiveTurn: () => boolean
}

const browserActions = new Set<WorkbenchBrowserAction>([
  "back",
  "forward",
  "reload",
  "stop",
  "devtools",
])

/** 负责注册工作台的 IPC，并在账号、页面或窗口变化时释放本地资源。 */
export class WorkbenchIpc {
  readonly #browsers = new WorkbenchBrowsers()
  readonly #terminals = new WorkbenchTerminals()
  readonly #windows = new Map<BrowserWindow, Electron.WebContents>()

  /** 为当前会话创建独立的本机网页预览工具。 */
  tools(owner: Electron.WebContents, canUse: () => boolean) {
    return browserSessionTools(owner, this.#browsers, canUse)
  }

  /** 注册仅供主窗口 preload 调用的工作台命令。 */
  register(options: WorkbenchIpcOptions): void {
    function handle(
      name: string,
      action: (window: BrowserWindow, event: IpcMainInvokeEvent, args: unknown[]) => unknown,
      needsMembership = true,
    ): void {
      ipcMain.handle("pigclaude:workbench-" + name, async (event, ...args: unknown[]) => {
        if (!options.isTrusted(event)) throw new Error("UNTRUSTED_WORKSPACE_REQUEST")
        if (needsMembership && options.membership()?.state !== "active")
          throw new Error("MEMBERSHIP_REQUIRED")
        const window = BrowserWindow.fromWebContents(event.sender)
        if (!window) throw new Error("WORKBENCH_WINDOW_UNAVAILABLE")
        try {
          return await action(window, event, args)
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : ""
          if (
            /^(WORKBENCH_[A-Z_]+|PREVIEW_URL_NOT_ALLOWED|URL_NOT_ALLOWED|GH_NOT_AVAILABLE|GH_NOT_AUTHENTICATED|GIT_NO_REMOTE|MEMBERSHIP_REQUIRED)$/.test(
              message,
            )
          ) {
            throw new Error(message)
          }
          const code = error && typeof error === "object" && "code" in error ? error.code : null
          if (process.env.CI && typeof code === "string" && /^[A-Z0-9_]{1,35}$/.test(code)) {
            console.error("Workbench IPC failed", name, code)
          }
          throw new Error("WORKBENCH_OPERATION_FAILED")
        }
      })
    }

    const project = (root: unknown) =>
      options.roots().then((roots) => workspaceDirectory(root, roots))
    handle("list", async (_window, _event, [root, path]) =>
      listWorkbenchDirectory(await project(root), string(path, 4096)),
    )
    handle("search", async (_window, _event, [root, query]) =>
      searchWorkbenchFiles(await project(root), string(query, 400)),
    )
    handle("read", async (_window, _event, [root, path]) =>
      readWorkbenchFile(await project(root), string(path, 4096)),
    )
    handle("save", async (_window, _event, [root, path, text, mtime]) =>
      saveWorkbenchFile(
        await project(root),
        string(path, 4096),
        string(text, 512 * 1024),
        mtime === null ? null : number(mtime, 0, Number.MAX_SAFE_INTEGER, false),
      ),
    )
    handle("diff", async (_window, _event, [root, path, checkpoint]) => {
      const directory = await project(root)
      const checkpoints = await listWorkbenchCheckpoints(directory).catch(() => [])
      const latest = checkpoints.filter((item) => item.phase === "baseline").at(-1)?.id
      const selected = checkpoint === undefined ? latest : checkpoint
      const base =
        selected === undefined || selected === "HEAD"
          ? undefined
          : await resolveWorkbenchCheckpoint(directory, string(selected, 64))
      return workbenchDiff(directory, path === undefined ? undefined : string(path, 4096), base)
    })
    handle("worktrees", async (_window, _event, [root]) =>
      listWorkbenchWorktrees(await project(root)),
    )
    handle("worktree-create", async (_window, _event, [root]) =>
      createWorkbenchWorktree(await project(root)),
    )
    handle("worktree-remove", async (_window, _event, [root, path]) =>
      removeWorkbenchWorktree(await project(root), string(path, 4096)),
    )
    handle("checkpoints", async (_window, _event, [root]) =>
      listWorkbenchCheckpoints(await project(root)),
    )
    handle("checkpoint-create", async (_window, _event, [root]) => {
      await captureWorkbenchCheckpoint(await project(root))
    })
    handle("checkpoint-restore", async (_window, _event, [root, checkpoint]) => {
      if (options.hasActiveTurn()) throw new Error("WORKBENCH_TURN_ACTIVE")
      const directory = await project(root)
      if (options.hasActiveTurn()) throw new Error("WORKBENCH_TURN_ACTIVE")
      return restoreWorkbenchCheckpoint(directory, string(checkpoint, 64))
    })
    handle("pr", async (_window, _event, [root]) => readWorkbenchPullRequest(await project(root)))
    handle("pr-create", async (_window, _event, [root, value]) => {
      if (!value || typeof value !== "object") throw new Error("WORKBENCH_INPUT_INVALID")
      const { title, body, base } = value as Record<string, unknown>
      const cleaned = string(title, 400).trim()
      if (!cleaned) throw new Error("WORKBENCH_INPUT_INVALID")
      return createWorkbenchPullRequest(await project(root), {
        title: cleaned,
        ...(body === undefined ? {} : { body: string(body, 32 * 1024) }),
        ...(base === undefined ? {} : { base: string(base, 250) }),
      })
    })
    handle("terminal-open", async (_window, event, [root, id, cols, rows]) => {
      const directory = await project(root)
      if (!options.isTrusted(event) || options.membership()?.state !== "active") {
        throw new Error("MEMBERSHIP_REQUIRED")
      }
      return this.#terminals.open(event.sender, resourceId(id), directory, {
        cols: number(cols === undefined ? 80 : cols, 1, 500),
        rows: number(rows === undefined ? 24 : rows, 1, 300),
      })
    })
    handle("terminal-write", (_window, event, [id, data]) =>
      this.#terminals.write(event.sender, resourceId(id), string(data, 128 * 1024)),
    )
    handle("terminal-resize", (_window, event, [id, cols, rows]) =>
      this.#terminals.resize(
        event.sender,
        resourceId(id),
        number(cols, 1, 500),
        number(rows, 1, 300),
      ),
    )
    handle(
      "terminal-close",
      (_window, event, [id]) => this.#terminals.close(event.sender, resourceId(id)),
      false,
    )
    handle("browser-navigate", (window, _event, [id, url]) =>
      this.#browsers.navigate(window, resourceId(id), url),
    )
    handle("browser-command", (window, _event, [id, action]) => {
      if (!browserActions.has(action as WorkbenchBrowserAction))
        throw new Error("WORKBENCH_INPUT_INVALID")
      this.#browsers.command(window, resourceId(id), action as WorkbenchBrowserAction)
    })
    handle(
      "browser-present",
      (window, _event, [id, value]) => {
        const key = resourceId(id)
        if (value === null) return this.#browsers.present(window, key, null)
        if (options.membership()?.state !== "active") throw new Error("MEMBERSHIP_REQUIRED")
        if (typeof value !== "object" || !value) throw new Error("WORKBENCH_INPUT_INVALID")
        const bounds = value as Record<string, unknown>
        this.#browsers.present(window, key, {
          x: number(bounds.x, 0, 32768),
          y: number(bounds.y, 0, 32768),
          width: number(bounds.width, 1, 32768),
          height: number(bounds.height, 1, 32768),
          scale: number(bounds.scale, 0.1, 1, false),
        })
      },
      false,
    )
    handle("browser-pick", (window, _event, [id]) => this.#browsers.pick(window, resourceId(id)))
    handle(
      "browser-close",
      (window, _event, [id]) => this.#browsers.close(window, resourceId(id)),
      false,
    )
    handle("browser-external", (_window, _event, [url]) => this.#browsers.external(url))
    handle("preview-open", (window, _event, [url]) => this.#browsers.preview(window, url))
  }

  /** 刷新、崩溃或关闭主窗口会释放其 PTY 和浏览器。 */
  track(window: BrowserWindow): void {
    const contents = window.webContents
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("https://")) void this.#browsers.external(url).catch(() => undefined)
      return { action: "deny" }
    })
    this.#windows.set(window, contents)
    const close = () => {
      this.#browsers.closeWindow(window)
      void this.#terminals.closeWindow(contents).catch(() => undefined)
    }
    contents.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
      if (!inPlace && mainFrame) close()
    })
    contents.on("render-process-gone", close)
    window.once("closed", () => {
      this.#windows.delete(window)
      close()
    })
  }

  /** 会员资格失效后释放旧窗口的工作台资源。 */
  membershipChanged(view: MembershipView): void {
    if (view.state !== "active") void this.dispose().catch(() => undefined)
  }

  /** 退出前关闭预览并等待终端结束。 */
  async dispose(): Promise<void> {
    for (const window of this.#windows.keys()) this.#browsers.closeWindow(window)
    await this.#terminals.dispose()
  }
}

function string(value: unknown, limit: number): string {
  if (typeof value !== "string" || value.length > limit) throw new Error("WORKBENCH_INPUT_INVALID")
  return value
}

function number(value: unknown, min: number, max: number, integer = true): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (integer && !Number.isInteger(value)) ||
    value < min ||
    value > max
  )
    throw new Error("WORKBENCH_INPUT_INVALID")
  return value
}

function resourceId(value: unknown): string {
  const id = string(value, 36)
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("WORKBENCH_INPUT_INVALID")
  return id
}
