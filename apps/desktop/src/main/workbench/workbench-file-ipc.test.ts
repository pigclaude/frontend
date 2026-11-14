// 负责验证文件面板的系统操作 IPC：用外部编辑器或默认应用打开、另存为，只接受已登记项目里的普通文件。
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { IpcMainInvokeEvent } from "electron"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
  shell: { openPath: electron.openPath },
  dialog: { showSaveDialog: electron.showSaveDialog },
  app: { getPath: () => downloads },
}))

vi.mock("./installed-editors", () => ({
  installedEditors: () => [cursor],
  launchEditor: editors.launch,
}))
vi.mock("./browser-surface", () => ({ WorkbenchBrowsers: class {} }))
vi.mock("./terminal-service", () => ({ WorkbenchTerminals: class {} }))

const trustedSender = { id: "trusted" }
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
  electron.showSaveDialog.mockClear()
  editors.launch.mockClear()
  directory = await realpath(await mkdtemp(join(tmpdir(), "pigclaude-workbench-files-")))
  project = join(directory, "project")
  downloads = join(directory, "downloads")
  await mkdir(project)
  await mkdir(downloads)
  state = "active"
  new WorkbenchIpc().register({
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

    for (const name of ["editors", "open-file", "save-as"]) {
      const handler = handlers.get("pigclaude:workbench-" + name)
      await expect(handler?.(stranger, project, "notes.md", null)).rejects.toThrow(
        "UNTRUSTED_WORKSPACE_REQUEST",
      )
    }
    state = "expired"
    for (const name of ["editors", "open-file", "save-as"]) {
      await expect(call(name, project, "notes.md", null)).rejects.toThrow("MEMBERSHIP_REQUIRED")
    }
    state = "active"
    const malformed: [string, ...unknown[]][] = [
      ["open-file", project, "notes.md", "Cursor.app"],
      ["open-file", project, "notes.md", 42],
      ["open-file", project, 42, null],
      ["save-as", project, "x".repeat(4097)],
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
    await expect(call("open-file", directory, "outside.md", null)).rejects.toThrow(
      "WORKBENCH_PROJECT_REQUIRED",
    )

    expect(electron.openPath).not.toHaveBeenCalled()
    expect(editors.launch).not.toHaveBeenCalled()
    expect(electron.showSaveDialog).not.toHaveBeenCalled()
  })
})
