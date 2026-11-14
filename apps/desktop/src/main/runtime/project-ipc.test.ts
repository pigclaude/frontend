// 负责验证侧栏项目操作的 IPC：校验来源、会员和参数，只操作已登记的项目，失败只返回登记过的错误码。

import { mkdir, mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { IpcMain, IpcMainInvokeEvent } from "electron"
import type { MembershipView } from "@pigclaude/contracts/membership"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerProjectIpc, settleOpenPath } from "./project-ipc"
import { ProjectNameStore } from "./project-names"
import { WorkspaceStore } from "./workspace-store"

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

let directory: string
let project: string
let other: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pigclaude-project-ipc-"))
  project = join(directory, "api")
  other = join(directory, "web")
  await mkdir(project)
  await mkdir(other)
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function setup(options: { trusted?: boolean; membership?: MembershipView["state"] } = {}) {
  const handlers = new Map<string, Handler>()
  const workspaces = new WorkspaceStore({ filePath: join(directory, "workspaces.json") })
  const names = new ProjectNameStore({ filePath: join(directory, "project-names.json") })
  await workspaces.add(other)
  await workspaces.add(project)
  const revealed: string[] = []
  const opened: string[] = []
  const state = { reveal: "", launch: true }
  registerProjectIpc(
    {
      handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
    } as unknown as Pick<IpcMain, "handle">,
    {
      isTrusted: () => options.trusted ?? true,
      membership: () => ({ state: options.membership ?? "active" }) as MembershipView,
      workspaces: () => workspaces,
      names: () => names,
      reveal: async (path) => {
        revealed.push(path)
        return state.reveal
      },
      apps: () => [
        { id: "finder", name: "Finder", kind: "file-manager", location: "/Finder.app" },
        { id: "cursor", name: "Cursor", kind: "editor", location: "/Applications/Cursor.app" },
      ],
      openWith: async (app, folder) => {
        if (!state.launch) throw new Error("spawn /Applications/Cursor.app ENOENT")
        opened.push(`${app.id} ${folder}`)
      },
    },
  )
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(`pigclaude:projects-${channel}`)
    if (!handler) throw new Error(`missing ${channel}`)
    return handler({} as IpcMainInvokeEvent, ...args)
  }
  return { invoke, workspaces, revealed, opened, state }
}

describe("settleOpenPath", () => {
  it("passes the system result through, and treats a hung open as handed to the system", async () => {
    await expect(settleOpenPath(Promise.resolve("No application"))).resolves.toBe("No application")
    await expect(settleOpenPath(new Promise<string>(() => undefined), 10)).resolves.toBe("")
  })
})

describe("registerProjectIpc", () => {
  it("renames a registered project and lists its display name", async () => {
    const { invoke } = await setup()

    await expect(invoke("rename", project, "后端")).resolves.toEqual({ [project]: "后端" })
    await expect(invoke("names")).resolves.toEqual({ [project]: "后端" })
  })

  it("removes a project from the sidebar, forgets its name and keeps the folder", async () => {
    const { invoke } = await setup()
    await invoke("rename", project, "后端")

    await expect(invoke("remove", project)).resolves.toEqual([other])
    await expect(invoke("names")).resolves.toEqual({})
    expect((await stat(project)).isDirectory()).toBe(true)
  })

  it("reveals only a registered project folder", async () => {
    const { invoke, revealed, state } = await setup()

    await expect(invoke("reveal", project)).resolves.toBeUndefined()
    expect(revealed).toEqual([project])
    await expect(invoke("reveal", join(directory, "elsewhere"))).rejects.toThrow(
      /^PROJECT_NOT_FOUND$/,
    )
    state.reveal = "The folder could not be opened at /secret/path"
    await expect(invoke("reveal", project)).rejects.toThrow(/^PROJECT_OPEN_FAILED$/)
  })

  it("lists installed apps without their locations and opens a registered project with one", async () => {
    const { invoke, opened, state } = await setup()

    await expect(invoke("apps")).resolves.toEqual([
      { id: "finder", name: "Finder", kind: "file-manager" },
      { id: "cursor", name: "Cursor", kind: "editor" },
    ])
    await expect(invoke("open-with", project, "cursor")).resolves.toBeUndefined()
    expect(opened).toEqual([`cursor ${project}`])
    await expect(invoke("open-with", project, "vim")).rejects.toThrow(/^PROJECT_APP_NOT_FOUND$/)
    await expect(invoke("open-with", join(directory, "elsewhere"), "cursor")).rejects.toThrow(
      /^PROJECT_NOT_FOUND$/,
    )
    state.launch = false
    await expect(invoke("open-with", project, "cursor")).rejects.toThrow(/^PROJECT_OPEN_FAILED$/)
  })

  it("rejects untrusted senders, missing membership and bad arguments", async () => {
    const untrusted = await setup({ trusted: false })
    for (const channel of ["names", "rename", "remove", "reveal", "apps", "open-with"]) {
      await expect(untrusted.invoke(channel, project, "x")).rejects.toThrow(
        /^UNTRUSTED_WORKSPACE_REQUEST$/,
      )
    }

    const lapsed = await setup({ membership: "expired" })
    for (const channel of ["rename", "remove", "reveal", "apps", "open-with"]) {
      await expect(lapsed.invoke(channel, project, "x")).rejects.toThrow(/^MEMBERSHIP_REQUIRED$/)
    }
    await expect(lapsed.invoke("names")).resolves.toEqual({})

    const { invoke, workspaces } = await setup()
    await expect(invoke("rename", project, 42)).rejects.toThrow(/^PROJECT_NAME_INVALID$/)
    await expect(invoke("rename", project, "  ")).rejects.toThrow(/^PROJECT_NAME_INVALID$/)
    await expect(invoke("rename", "relative", "x")).rejects.toThrow(/^PROJECT_NOT_FOUND$/)
    await expect(invoke("remove", { path: project })).rejects.toThrow(/^PROJECT_NOT_FOUND$/)
    await expect(invoke("remove", join(directory, "elsewhere"))).rejects.toThrow(
      /^PROJECT_NOT_FOUND$/,
    )
    await expect(workspaces.list()).resolves.toEqual([project, other])
  })
})
