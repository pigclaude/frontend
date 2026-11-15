// 负责验证工作台 IPC 的边界：来源与会员门禁、已登记项目、参数校验、错误码收敛和窗口资源回收。
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { BrowserWindow, IpcMainInvokeEvent } from "electron"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WorkbenchIpc, type WorkbenchIpcOptions } from "./workbench-ipc"

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>
type Listener = (...args: unknown[]) => void

const { handlers, windows, fakes } = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  windows: new Map<unknown, unknown>(),
  fakes: {
    browsers: [] as Record<string, ReturnType<typeof vi.fn>>[],
    terminals: [] as Record<string, ReturnType<typeof vi.fn>>[],
  },
}))

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    },
  },
  BrowserWindow: { fromWebContents: (contents: unknown) => windows.get(contents) ?? null },
}))

vi.mock("./browser-surface", () => ({
  WorkbenchBrowsers: class {
    constructor() {
      const self = this as unknown as Record<string, ReturnType<typeof vi.fn>>
      for (const name of [
        "navigate",
        "command",
        "present",
        "pick",
        "close",
        "closeWindow",
        "closeAgent",
        "setActiveSession",
        "listAgentTabs",
        "requireActiveAgent",
      ])
        self[name] = vi.fn()
      self["external"] = vi.fn(async () => undefined)
      self["closeWindow"] = vi.fn(async () => undefined)
      self["preview"] = vi.fn(async () => ({ id: "preview" }))
      fakes.browsers.push(self)
    }
  },
}))

vi.mock("./terminal-service", () => ({
  WorkbenchTerminals: class {
    constructor() {
      const self = this as unknown as Record<string, ReturnType<typeof vi.fn>>
      self["open"] = vi.fn(() => ({ shell: "zsh", cwd: "/" }))
      for (const name of ["write", "resize"]) self[name] = vi.fn()
      for (const name of ["close", "closeWindow", "dispose"])
        self[name] = vi.fn(async () => undefined)
      fakes.terminals.push(self)
    }
  },
}))

const resourceId = "0f8fad5b-d9cb-469f-a165-70867728950e"
let directory: string
let project: string
let state: MembershipView["state"]
let activeTurns: string[]
let ipc: WorkbenchIpc

type FakeContents = {
  on: Listener
  setWindowOpenHandler: (handler: (details: { url: string }) => unknown) => void
  emit: (name: string, ...args: unknown[]) => void
  openHandler: ((details: { url: string }) => unknown) | null
}

function contents(): FakeContents {
  const listeners = new Map<string, Listener[]>()
  const fake: FakeContents = {
    on: (...args: unknown[]) => {
      const [name, listener] = args as [string, Listener]
      listeners.set(name, [...(listeners.get(name) ?? []), listener])
    },
    setWindowOpenHandler: (handler) => {
      fake.openHandler = handler
    },
    emit: (name, ...args) => listeners.get(name)?.forEach((listener) => listener(...args)),
    openHandler: null,
  }
  return fake
}

function fakeWindow() {
  const webContents = contents()
  const closed: Listener[] = []
  const window = {
    webContents,
    once: (name: string, listener: Listener) => {
      if (name === "closed") closed.push(listener)
    },
    close: () => closed.forEach((listener) => listener()),
  }
  windows.set(webContents, window)
  return { window, webContents, browserWindow: window as unknown as BrowserWindow }
}

const trusted = fakeWindow()
const stranger = fakeWindow()

function event(sender: unknown = trusted.webContents): IpcMainInvokeEvent {
  return { sender } as unknown as IpcMainInvokeEvent
}

function call(name: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get("pigclaude:workbench-" + name)
  if (!handler) throw new Error("handler not registered: " + name)
  return handler(event(), ...args)
}

function browsers() {
  const fake = fakes.browsers.at(-1)
  if (!fake) throw new Error("browsers not created")
  return fake
}

function terminals() {
  const fake = fakes.terminals.at(-1)
  if (!fake) throw new Error("terminals not created")
  return fake
}

beforeEach(async () => {
  handlers.clear()
  directory = await realpath(await mkdtemp(join(tmpdir(), "pigclaude-workbench-ipc-")))
  project = directory
  state = "active"
  activeTurns = []
  ipc = new WorkbenchIpc()
  const options: WorkbenchIpcOptions = {
    isTrusted: (value) => (value.sender as unknown) === trusted.webContents,
    membership: () => ({ state }) as MembershipView,
    roots: async () => [project],
    rememberWorktree: async () => undefined,
    hasActiveTurn: (workspace) => activeTurns.includes(workspace),
  }
  ipc.register(options)
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe("workbench IPC", () => {
  it("rejects requests from frames other than the trusted main window", async () => {
    const list = handlers.get("pigclaude:workbench-list")
    const close = handlers.get("pigclaude:workbench-terminal-close")

    await expect(list?.(event(stranger.webContents), project, "")).rejects.toThrow(
      "UNTRUSTED_WORKSPACE_REQUEST",
    )
    await expect(close?.(event(stranger.webContents), resourceId)).rejects.toThrow(
      "UNTRUSTED_WORKSPACE_REQUEST",
    )
    expect(terminals()["close"]).not.toHaveBeenCalled()
  })

  it("requires an active membership except for releasing terminals and browsers", async () => {
    state = "expired"

    await expect(call("list", project, "")).rejects.toThrow("MEMBERSHIP_REQUIRED")
    await expect(call("terminal-open", project, resourceId, 80, 24)).rejects.toThrow(
      "MEMBERSHIP_REQUIRED",
    )
    await expect(
      call("browser-present", resourceId, { x: 0, y: 0, width: 10, height: 10, scale: 1 }),
    ).rejects.toThrow("MEMBERSHIP_REQUIRED")
    expect(terminals()["open"]).not.toHaveBeenCalled()

    await call("terminal-close", resourceId)
    await call("browser-close", resourceId)
    await call("browser-present", resourceId, null)
    expect(terminals()["close"]).toHaveBeenCalledWith(trusted.webContents, resourceId)
    expect(browsers()["close"]).toHaveBeenCalledWith(trusted.browserWindow, resourceId, undefined)
    expect(browsers()["present"]).toHaveBeenCalledWith(
      trusted.browserWindow,
      resourceId,
      null,
      undefined,
    )
  })

  it("passes only validated session scopes to native browser actions", async () => {
    const id = "agent-" + resourceId
    const scope = { id, sessionId: "session-a" }
    await call("browser-active-session", scope.sessionId)
    await call("browser-agent-tabs", scope.sessionId)
    await call("browser-command", id, "reload", scope.sessionId)
    await call("browser-pick", id, scope.sessionId)
    await call("preview-open", "http://localhost:3000/", scope)

    const native = browsers()
    expect(native["setActiveSession"]).toHaveBeenCalledWith(trusted.browserWindow, scope.sessionId)
    expect(native["listAgentTabs"]).toHaveBeenCalledWith(trusted.browserWindow, scope.sessionId)
    expect(native["command"]).toHaveBeenCalledWith(
      trusted.browserWindow,
      id,
      "reload",
      scope.sessionId,
    )
    expect(native["pick"]).toHaveBeenCalledWith(trusted.browserWindow, id, scope.sessionId)
    expect(native["requireActiveAgent"]).toHaveBeenCalledWith(trusted.browserWindow, scope)
    await expect(call("browser-pick", id, " ")).rejects.toThrow("WORKBENCH_INPUT_INVALID")
  })

  it("lists and reads files only inside a registered project", async () => {
    await writeFile(join(project, "notes.md"), "hello\n")

    await expect(call("list", project, "")).resolves.toEqual({
      truncated: false,
      entries: [{ name: "notes.md", path: "notes.md", kind: "file" }],
    })
    await expect(call("read", project, "notes.md")).resolves.toMatchObject({
      path: "notes.md",
      text: "hello\n",
    })
    await expect(call("list", join(directory, "elsewhere"), "")).rejects.toThrow(
      "WORKBENCH_PROJECT_REQUIRED",
    )
    await expect(call("list", "relative/project", "")).rejects.toThrow("WORKBENCH_PROJECT_REQUIRED")
  })

  it("rejects malformed arguments as WORKBENCH_INPUT_INVALID", async () => {
    const invalid: [string, ...unknown[]][] = [
      ["list", project, 42],
      ["search", project, "x".repeat(401)],
      ["save", project, "notes.md", "x".repeat(512 * 1024 + 1), null],
      ["terminal-open", project, "not-a-resource-id", 80, 24],
      ["terminal-open", project, resourceId, 0, 24],
      ["terminal-open", project, resourceId, 80, 301],
      ["terminal-write", resourceId, "x".repeat(128 * 1024 + 1)],
      ["terminal-resize", resourceId, 80.5, 24],
      ["browser-command", resourceId, "eval"],
      ["browser-present", resourceId, { x: 0, y: 0, width: 10, height: 10, scale: 2 }],
      ["browser-present", resourceId, "full"],
      ["pr-create", project, { title: "   " }],
      ["pr-create", project, "title"],
    ]

    for (const [name, ...args] of invalid) {
      await expect(call(name, ...args), name).rejects.toThrow("WORKBENCH_INPUT_INVALID")
    }
    expect(terminals()["open"]).not.toHaveBeenCalled()
    expect(terminals()["write"]).not.toHaveBeenCalled()
    expect(browsers()["command"]).not.toHaveBeenCalled()
  })

  it("passes registered error codes through and hides every other failure", async () => {
    terminals()["open"]?.mockImplementationOnce(() => {
      throw new Error("WORKBENCH_TERMINAL_LIMIT")
    })
    await expect(call("terminal-open", project, resourceId, 80, 24)).rejects.toThrow(
      "WORKBENCH_TERMINAL_LIMIT",
    )

    terminals()["open"]?.mockImplementationOnce(() => {
      throw new Error("spawn EACCES /Users/me/.secret/zsh")
    })
    const leaked = call("terminal-open", project, resourceId, 80, 24)
    await expect(leaked).rejects.toThrow(/^WORKBENCH_OPERATION_FAILED$/)

    await expect(call("read", project, "missing.txt")).rejects.toThrow(
      /^WORKBENCH_OPERATION_FAILED$/,
    )
  })

  it("logs only the git subcommand, exit code and signal of a hidden failure in CI", async () => {
    vi.stubEnv("CI", "true")
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    try {
      await expect(call("checkpoints", project)).rejects.toThrow(/^WORKBENCH_OPERATION_FAILED$/)
      expect(log).toHaveBeenCalledWith(
        "Workbench IPC failed",
        "checkpoints",
        "git rev-parse code=128 signal=none",
      )
      expect(JSON.stringify(log.mock.calls)).not.toContain(project)
    } finally {
      log.mockRestore()
      vi.unstubAllEnvs()
    }
  })

  it("refuses to restore a checkpoint while a turn is running", async () => {
    activeTurns = [project]

    await expect(call("checkpoint-restore", project, "manual-" + resourceId)).rejects.toThrow(
      "WORKBENCH_TURN_ACTIVE",
    )
  })

  it("gives each session tools whose close shuts only that session's agent browser", () => {
    const first = ipc.tools(trusted.webContents as unknown as Electron.WebContents, () => true)
    const second = ipc.tools(trusted.webContents as unknown as Electron.WebContents, () => true)

    first.close()

    const approval = {
      denial: () => null,
      rememberCaller: () => undefined,
      request: async () => false,
    }
    expect(Object.keys(first.browser?.create(approval, "first-session") ?? {})).toEqual([
      "pigclaude_workbench",
    ])
    expect(browsers()["closeAgent"]).toHaveBeenCalledTimes(1)
    second.close()
    const ids = browsers()["closeAgent"]?.mock.calls.map(([id]) => id)
    expect(new Set(ids).size).toBe(2)
  })

  it("opens terminals in the validated project for the calling window", async () => {
    await expect(call("terminal-open", project, resourceId)).resolves.toEqual({
      shell: "zsh",
      cwd: "/",
    })

    expect(terminals()["open"]).toHaveBeenCalledWith(trusted.webContents, resourceId, project, {
      cols: 80,
      rows: 24,
    })
  })

  it("releases a window's terminals and browsers when it reloads, crashes or closes", () => {
    const { window, webContents, browserWindow } = fakeWindow()
    ipc.track(browserWindow)
    const released = () => [
      browsers()["closeWindow"]?.mock.calls.length,
      terminals()["closeWindow"]?.mock.calls.length,
    ]

    webContents.emit("did-start-navigation", {}, "app://index.html#chat", true, true)
    webContents.emit("did-start-navigation", {}, "https://frame.test/", false, false)
    expect(released()).toEqual([0, 0])

    webContents.emit("did-start-navigation", {}, "app://index.html", false, true)
    expect(released()).toEqual([1, 1])
    webContents.emit("render-process-gone", {}, { reason: "crashed" })
    expect(released()).toEqual([2, 2])
    window.close()
    expect(released()).toEqual([3, 3])
    expect(browsers()["closeWindow"]).toHaveBeenLastCalledWith(browserWindow)
    expect(terminals()["closeWindow"]).toHaveBeenLastCalledWith(webContents)
  })

  it("releases every tracked window's resources when membership ends", () => {
    const first = fakeWindow()
    const second = fakeWindow()
    ipc.track(first.browserWindow)
    ipc.track(second.browserWindow)

    ipc.membershipChanged({ state: "active" } as MembershipView)
    expect(browsers()["closeWindow"]).not.toHaveBeenCalled()
    expect(terminals()["dispose"]).not.toHaveBeenCalled()

    ipc.membershipChanged({ state: "expired" } as MembershipView)
    expect(browsers()["closeWindow"]).toHaveBeenCalledWith(first.browserWindow)
    expect(browsers()["closeWindow"]).toHaveBeenCalledWith(second.browserWindow)
    expect(terminals()["dispose"]).toHaveBeenCalledTimes(1)
  })

  it("opens only https pop-ups in the system browser and never creates windows", () => {
    const { webContents, browserWindow } = fakeWindow()
    ipc.track(browserWindow)
    const open = webContents.openHandler

    expect(open?.({ url: "https://docs.example.com/" })).toEqual({ action: "deny" })
    expect(open?.({ url: "http://127.0.0.1:3000/" })).toEqual({ action: "deny" })
    expect(open?.({ url: "file:///etc/passwd" })).toEqual({ action: "deny" })
    expect(browsers()["external"]).toHaveBeenCalledTimes(1)
    expect(browsers()["external"]).toHaveBeenCalledWith("https://docs.example.com/")
  })
})
