// 负责验证文件面板的系统操作 IPC：Git 状态、在文件管理器中显示、用外部编辑器或默认应用打开、另存为，
// 只接受已登记项目里的路径。
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { IpcMainInvokeEvent } from "electron"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { UnsavedOwner } from "./unsaved-files"
import { WorkbenchIpc } from "./workbench-ipc"

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

const { handlers, electron, editors, cursor } = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  cursor: { id: "cursor", name: "Cursor", location: "/Applications/Cursor.app" },
  editors: {
    launch: vi.fn<(editor: unknown, file: string) => Promise<void>>(async () => undefined),
  },
  electron: {
    window: { id: "main-window" },
    openPath: vi.fn<(path: string) => Promise<string>>(async () => ""),
    showItemInFolder: vi.fn<(path: string) => void>(),
    showSaveDialog: vi.fn<
      (
        window: unknown,
        options: { defaultPath?: string },
      ) => Promise<{
        canceled: boolean
        filePath?: string
      }>
    >(async () => ({ canceled: true })),
  },
}))

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    },
  },
  BrowserWindow: {
    fromWebContents: (contents: unknown) => (contents === trustedSender ? electron.window : null),
  },
  shell: { openPath: electron.openPath, showItemInFolder: electron.showItemInFolder },
  dialog: { showSaveDialog: electron.showSaveDialog },
  app: { getPath: () => downloads },
}))

vi.mock("./installed-editors", () => ({
  installedEditors: () => [cursor],
  launchEditor: editors.launch,
}))
vi.mock("./browser-surface", () => ({ WorkbenchBrowsers: class {} }))
vi.mock("./terminal-service", () => ({ WorkbenchTerminals: class {} }))

const sent: Array<{ id: string }> = []
const trustedSender = {
  id: "trusted",
  isDestroyed: () => false,
  send: (_channel: string, event: { id: string }) => sent.push(event),
}
let ipc: WorkbenchIpc
let directory: string
let project: string
let downloads: string
let state: MembershipView["state"]

function call(name: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get("pigclaude:workbench-" + name)
  if (!handler) throw new Error("handler not registered: " + name)
  return handler({ sender: trustedSender } as unknown as IpcMainInvokeEvent, ...args)
}

beforeEach(async () => {
  handlers.clear()
  electron.openPath.mockClear()
  electron.showItemInFolder.mockClear()
  electron.showSaveDialog.mockClear()
  editors.launch.mockClear()
  directory = await realpath(await mkdtemp(join(tmpdir(), "pigclaude-workbench-files-")))
  project = join(directory, "project")
  downloads = join(directory, "downloads")
  await mkdir(project)
  await mkdir(downloads)
  state = "active"
  sent.length = 0
  ipc = new WorkbenchIpc()
  ipc.register({
    isTrusted: (event) => (event.sender as unknown) === trustedSender,
    membership: () => ({ state }) as MembershipView,
    roots: async () => [project],
    hasActiveTurn: () => false,
  })
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe("workbench file actions", () => {
  it("reports Git changes of a project and nothing for a plain folder", async () => {
    await writeFile(join(project, "notes.md"), "hello\n")
    await expect(call("status", project)).resolves.toBeNull()

    await promisify(execFile)("git", ["init", "-q"], { cwd: project })

    await expect(call("status", project)).resolves.toEqual([{ path: "notes.md", status: "??" }])
  })

  it("keeps the unsaved file count the page reports, even without membership", async () => {
    const sender: UnsavedOwner = trustedSender
    state = "expired"
    await call("unsaved", 2)
    expect(ipc.unsaved.count(sender)).toBe(2)

    const saving = ipc.unsaved.save(sender)
    const [request] = sent
    await call("unsaved-done", request?.id, true)
    await expect(saving).resolves.toBe(true)

    await call("unsaved", 0)
    expect(ipc.unsaved.count()).toBe(0)
    for (const args of [[-1], [1.5], ["2"], [10_001]]) {
      await expect(call("unsaved", ...args)).rejects.toThrow("WORKBENCH_INPUT_INVALID")
    }
    await expect(call("unsaved-done", "not-an-id", true)).rejects.toThrow("WORKBENCH_INPUT_INVALID")
    await expect(call("unsaved-done", request?.id, "yes")).rejects.toThrow(
      "WORKBENCH_INPUT_INVALID",
    )
  })

  it("reveals project entries in the file manager and opens the project folder itself", async () => {
    await mkdir(join(project, "docs"))
    await writeFile(join(project, "docs", "notes.md"), "hello\n")

    await call("reveal", project, "docs/notes.md")
    await call("reveal", project, "docs")
    await call("reveal", project, "")

    expect(electron.showItemInFolder.mock.calls).toEqual([
      [join(project, "docs", "notes.md")],
      [join(project, "docs")],
    ])
    expect(electron.openPath).toHaveBeenCalledExactlyOnceWith(project)
  })

  it("opens a project file with the system default app and nothing outside the project", async () => {
    await mkdir(join(project, "docs"))
    await writeFile(join(project, "docs", "notes.md"), "hello\n")
    await writeFile(join(directory, "outside.md"), "outside\n")

    await call("open-file", project, "docs/notes.md", null)

    expect(electron.openPath).toHaveBeenCalledExactlyOnceWith(join(project, "docs", "notes.md"))
    await expect(call("open-file", project, "../outside.md", null)).rejects.toThrow(
      "WORKBENCH_PATH_INVALID",
    )
    expect(electron.openPath).toHaveBeenCalledTimes(1)
  })

  it("does not hand shortcuts or programs to the system default app", async () => {
    const program = process.platform === "win32" ? "run.bat" : "deploy.command"
    const programs = process.platform === "linux" ? [] : [program]
    for (const name of ["Setup.LNK", "app.desktop", "site.url", ...programs]) {
      await writeFile(join(project, name), "launch\n")
      await expect(call("open-file", project, name, null)).rejects.toThrow("WORKBENCH_OPEN_BLOCKED")
    }
    expect(electron.openPath).not.toHaveBeenCalled()

    await call("open-file", project, "Setup.LNK", "cursor")
    expect(editors.launch).toHaveBeenCalledExactlyOnceWith(cursor, join(project, "Setup.LNK"))
  })

  it("lists installed editors and opens a project file with the chosen one", async () => {
    await writeFile(join(project, "index.ts"), "export {}\n")

    await expect(call("editors")).resolves.toEqual([{ id: "cursor", name: "Cursor" }])
    await call("open-file", project, "index.ts", "cursor")

    expect(editors.launch).toHaveBeenCalledExactlyOnceWith(cursor, join(project, "index.ts"))
    await expect(call("open-file", project, "index.ts", "vscode")).rejects.toThrow(
      "WORKBENCH_APP_UNAVAILABLE",
    )
    expect(editors.launch).toHaveBeenCalledTimes(1)
    expect(electron.openPath).not.toHaveBeenCalled()
  })

  it("saves a copy only where the user chooses in the system dialog", async () => {
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0d, 0x0a])
    await writeFile(join(project, "logo.png"), image)
    const destination = join(directory, "elsewhere", "copy.png")
    await mkdir(join(directory, "elsewhere"))

    await expect(call("save-as", project, "logo.png")).resolves.toBe(false)
    expect(electron.showSaveDialog).toHaveBeenLastCalledWith(
      electron.window,
      expect.objectContaining({ defaultPath: join(downloads, "logo.png") }),
    )
    electron.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: destination })
    await expect(call("save-as", project, "logo.png")).resolves.toBe(true)

    expect(await readFile(destination)).toEqual(image)
    expect(await readFile(join(project, "logo.png"))).toEqual(image)
  })

  it("checks the caller, membership and arguments before touching any file", async () => {
    await writeFile(join(project, "notes.md"), "hello\n")
    await writeFile(join(directory, "outside.md"), "outside\n")
    await mkdir(join(project, "docs"))
    await mkdir(join(project, ".claude"))
    await writeFile(join(project, ".claude", "settings.local.json"), "{}\n")
    const links = process.platform === "win32" ? [] : ["link.md"]
    if (links.length > 0) await symlink(join(directory, "outside.md"), join(project, "link.md"))
    const stranger = { sender: { id: "stranger" } } as unknown as IpcMainInvokeEvent

    for (const name of ["status", "reveal", "editors", "open-file", "save-as", "unsaved"]) {
      const handler = handlers.get("pigclaude:workbench-" + name)
      await expect(handler?.(stranger, project, "notes.md", null)).rejects.toThrow(
        "UNTRUSTED_WORKSPACE_REQUEST",
      )
    }
    state = "expired"
    for (const name of ["status", "reveal", "editors", "open-file", "save-as"]) {
      await expect(call(name, project, "notes.md", null)).rejects.toThrow("MEMBERSHIP_REQUIRED")
    }
    state = "active"
    const malformed: [string, ...unknown[]][] = [
      ["open-file", project, "notes.md", "Cursor.app"],
      ["open-file", project, "notes.md", 42],
      ["open-file", project, 42, null],
      ["save-as", project, "x".repeat(4097)],
      ["reveal", project, 42],
    ]
    for (const [name, ...args] of malformed) {
      await expect(call(name, ...args), name).rejects.toThrow("WORKBENCH_INPUT_INVALID")
    }
    for (const path of ["", "docs", ".claude/settings.local.json", ...links]) {
      await expect(call("open-file", project, path, null), path).rejects.toThrow(
        "WORKBENCH_PATH_INVALID",
      )
      await expect(call("save-as", project, path), path).rejects.toThrow("WORKBENCH_PATH_INVALID")
    }
    for (const path of [".claude/settings.local.json", "../outside.md", ...links]) {
      await expect(call("reveal", project, path), path).rejects.toThrow("WORKBENCH_PATH_INVALID")
    }
    await expect(call("status", directory)).rejects.toThrow("WORKBENCH_PROJECT_REQUIRED")
    await expect(call("open-file", directory, "outside.md", null)).rejects.toThrow(
      "WORKBENCH_PROJECT_REQUIRED",
    )

    expect(electron.openPath).not.toHaveBeenCalled()
    expect(editors.launch).not.toHaveBeenCalled()
    expect(electron.showSaveDialog).not.toHaveBeenCalled()
    expect(electron.showItemInFolder).not.toHaveBeenCalled()
  })
})
