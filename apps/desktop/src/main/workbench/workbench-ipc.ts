// 注册工作台命令，绑定已选择的项目、会员状态和可信的主窗口。
import { randomUUID } from "node:crypto"
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron"
import type { MembershipView } from "@pigclaude/contracts/membership"
import {
  agentBrowserIdPrefix,
  type AgentBrowserScope,
  type WorkbenchBrowserAction,
} from "../../workbench-contract"
import type { SessionTools } from "../session/session-types"
import { WorkbenchBrowsers } from "./browser-surface"
import { browserSessionTools } from "./browser-tools"
import { describeWorkbenchGitFailure, gitExitCode } from "./git-command"
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
import { switchWorkbenchBranch, workbenchBranches } from "./git-branches"
import { workbenchStatus } from "./git-status"
import { installedEditors } from "./installed-editors"
import { WorkbenchTerminals } from "./terminal-service"
import { UnsavedFiles } from "./unsaved-files"
import {
  openWorkbenchFile,
  revealWorkbenchPath,
  saveWorkbenchFileAs,
} from "./workspace-file-actions"
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
  /** 和这个项目目录重叠的会话里有没有进行中的回合。 */
  hasActiveTurn: (workspace: string) => boolean
  /** 记下 path 这个 worktree 属于 from 所在的项目，之后它不占最近项目也能打开工作台。 */
  rememberWorktree: (path: string, from: string) => Promise<void>
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
  /** 页面报告的未保存文件；退出、关窗和刷新前由这里请页面保存或放弃。 */
  readonly unsaved = new UnsavedFiles()

  /** 为一个会话创建独立的本机网页预览工具；close 关掉这个会话打开的浏览器并清空它的分区。 */
  tools(owner: Electron.WebContents, canUse: () => boolean): SessionTools {
    const id = agentBrowserIdPrefix + randomUUID()
    let live = true
    return {
      browser: {
        create: (approval, sessionId) =>
          browserSessionTools(owner, this.#browsers, () => live && canUse(), approval, {
            id,
            sessionId,
          }),
      },
      close: () => {
        live = false
        return this.#browsers.closeAgent(id)
      },
    }
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
          if (process.env.CI) {
            const gitFailure = describeWorkbenchGitFailure(error)
            const code = gitExitCode(error)
            if (gitFailure) console.error("Workbench IPC failed", name, gitFailure)
            else if (typeof code === "string" && /^[A-Z0-9_]{1,35}$/.test(code))
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
    handle("editors", () => installedEditors().map(({ id, name }) => ({ id, name })))
    handle("open-file", async (_window, _event, [root, path, editor]) =>
      openWorkbenchFile(
        await project(root),
        string(path, 4096),
        editor === null ? null : editorId(editor),
      ),
    )
    handle("save-as", async (window, _event, [root, path]) =>
      saveWorkbenchFileAs(window, await project(root), string(path, 4096)),
    )
    handle("reveal", async (_window, _event, [root, path]) =>
      revealWorkbenchPath(await project(root), string(path, 4096)),
    )
    handle("status", async (_window, _event, [root]) => workbenchStatus(await project(root)))
    handle(
      "unsaved",
      (_window, event, [count]) => this.unsaved.report(event.sender, number(count, 0, 10_000)),
      false,
    )
    handle(
      "unsaved-done",
      (_window, event, [id, done]) =>
        this.unsaved.answer(event.sender, resourceId(id), boolean(done)),
      false,
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
    handle("worktree-create", async (_window, _event, [root, baseRef]) => {
      const created = await createWorkbenchWorktree(
        await project(root),
        baseRef === undefined ? undefined : string(baseRef, 300),
      )
      await options.rememberWorktree(created.path, string(root, 4096))
      return created
    })
    handle("worktree-use", async (_window, _event, [root, path]) => {
      const target = string(path, 4096)
      const worktrees = await listWorkbenchWorktrees(await project(root))
      if (!worktrees.some((item) => item.path === target)) throw new Error("WORKBENCH_PATH_INVALID")
      await options.rememberWorktree(target, string(root, 4096))
    })
    handle("branches", async (_window, _event, [root]) => workbenchBranches(await project(root)))
    handle("branch-switch", async (_window, _event, [root, branch, create]) => {
      const name = string(branch, 240)
      const creating = boolean(create)
      const directory = await project(root)
      if (options.hasActiveTurn(directory)) throw new Error("WORKBENCH_TURN_ACTIVE")
      return switchWorkbenchBranch(directory, name, creating)
    })
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
      const directory = await project(root)
      if (options.hasActiveTurn(directory)) throw new Error("WORKBENCH_TURN_ACTIVE")
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
    handle(
      "browser-active-session",
      (window, _event, [sessionId]) => {
        if (sessionId !== null && options.membership()?.state !== "active")
          throw new Error("MEMBERSHIP_REQUIRED")
        this.#browsers.setActiveSession(
          window,
          sessionId === null ? null : browserSessionId(sessionId),
        )
      },
      false,
    )
    handle("browser-agent-tabs", (window, _event, [sessionId]) =>
      this.#browsers.listAgentTabs(window, browserSessionId(sessionId)),
    )
    handle("browser-navigate", (window, _event, [id, url, sessionId]) =>
      this.#browsers.navigate(window, browserId(id), url, optionalSessionId(sessionId)),
    )
    handle("browser-command", (window, _event, [id, action, sessionId]) => {
      if (!browserActions.has(action as WorkbenchBrowserAction))
        throw new Error("WORKBENCH_INPUT_INVALID")
      this.#browsers.command(
        window,
        browserId(id),
        action as WorkbenchBrowserAction,
        optionalSessionId(sessionId),
      )
    })
    handle(
      "browser-present",
      (window, _event, [id, value, sessionId]) => {
        const key = browserId(id)
        const scope = optionalSessionId(sessionId)
        if (value === null) return this.#browsers.present(window, key, null, scope)
        if (options.membership()?.state !== "active") throw new Error("MEMBERSHIP_REQUIRED")
        if (typeof value !== "object" || !value) throw new Error("WORKBENCH_INPUT_INVALID")
        const bounds = value as Record<string, unknown>
        this.#browsers.present(
          window,
          key,
          {
            x: number(bounds.x, 0, 32768),
            y: number(bounds.y, 0, 32768),
            width: number(bounds.width, 1, 32768),
            height: number(bounds.height, 1, 32768),
            scale: number(bounds.scale, 0.1, 1, false),
          },
          scope,
        )
      },
      false,
    )
    handle("browser-pick", (window, _event, [id, sessionId]) =>
      this.#browsers.pick(window, browserId(id), optionalSessionId(sessionId)),
    )
    handle(
      "browser-close",
      (window, _event, [id, sessionId]) =>
        this.#browsers.close(window, browserId(id), optionalSessionId(sessionId)),
      false,
    )
    handle("browser-external", (window, _event, [url, value]) => {
      const scope = optionalAgentScope(value)
      if (scope) this.#browsers.requireActiveAgent(window, scope)
      return this.#browsers.external(url)
    })
    handle("preview-open", (window, _event, [url, value]) => {
      const scope = optionalAgentScope(value)
      if (scope) this.#browsers.requireActiveAgent(window, scope)
      return this.#browsers.preview(window, url)
    })
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
      this.unsaved.forget(contents)
      void this.#browsers.closeWindow(window).catch(() => undefined)
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
    await Promise.all([
      ...[...this.#windows.keys()].map((window) => this.#browsers.closeWindow(window)),
      this.#terminals.dispose(),
    ])
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

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("WORKBENCH_INPUT_INVALID")
  return value
}

function editorId(value: unknown): string {
  const id = string(value, 40)
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error("WORKBENCH_INPUT_INVALID")
  return id
}

function resourceId(value: unknown): string {
  const id = string(value, 36)
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("WORKBENCH_INPUT_INVALID")
  return id
}

function browserId(value: unknown): string {
  if (typeof value === "string" && value.startsWith(agentBrowserIdPrefix))
    return agentBrowserIdPrefix + resourceId(value.slice(agentBrowserIdPrefix.length))
  return resourceId(value)
}

function browserSessionId(value: unknown): string {
  const id = string(value, 128)
  if (!id.trim()) throw new Error("WORKBENCH_INPUT_INVALID")
  return id
}

function optionalSessionId(value: unknown): string | undefined {
  return value === undefined ? undefined : browserSessionId(value)
}

function optionalAgentScope(value: unknown): AgentBrowserScope | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "object" || !value || !("id" in value) || !("sessionId" in value))
    throw new Error("WORKBENCH_INPUT_INVALID")
  const id = browserId(value.id)
  if (!id.startsWith(agentBrowserIdPrefix)) throw new Error("WORKBENCH_INPUT_INVALID")
  return { id, sessionId: browserSessionId(value.sessionId) }
}
