// 注册最近工作区的读写入口和侧栏项目操作，仅允许受信的主窗口访问；工作台能打开的目录是最近项目
// 加上它们登记过的 worktree。

import { dirname, join } from "node:path"
import { ipcMain, shell } from "electron"
import type { MembershipView } from "@pigclaude/contracts/membership"
import { folderLaunch, installedOpenApps, launchInFolder } from "../workbench/open-apps"
import { registerProjectIpc, settleOpenPath } from "./project-ipc"
import { ProjectNameStore } from "./project-names"
import { listWorkspaceFiles } from "./workspace-files"
import { WorkspaceStore } from "./workspace-store"
import type { WorkbenchIpc } from "../workbench/workbench-ipc"
import { WorktreeRegistry } from "../workbench/worktree-registry"

/** 注册工作区入口并按需打开存储；写入只接受当前受信窗口的 frame。 */
export function registerWorkspaceIpc(input: {
  filePath: () => string
  isTrusted: (event: Electron.IpcMainInvokeEvent) => boolean
  workbench: WorkbenchIpc
  membership: () => MembershipView | undefined
  /** 和这个项目目录重叠的会话里有没有进行中的回合。 */
  hasActiveTurn: (workspace: string) => boolean
}): void {
  let store: WorkspaceStore | null = null
  let names: ProjectNameStore | null = null
  let worktrees: WorktreeRegistry | null = null
  const getStore = () => (store ??= new WorkspaceStore({ filePath: input.filePath() }))
  const getNames = () =>
    (names ??= new ProjectNameStore({
      filePath: join(dirname(input.filePath()), "project-names.json"),
    }))
  const getWorktrees = () =>
    (worktrees ??= new WorktreeRegistry({
      filePath: join(dirname(input.filePath()), "worktrees.json"),
    }))
  ipcMain.handle("pigclaude:workspaces-list", async (event) => {
    if (!input.isTrusted(event)) throw new Error("UNTRUSTED_WORKSPACE_REQUEST")
    return getStore().list()
  })
  ipcMain.handle("pigclaude:workspaces-available", async (event) => {
    if (!input.isTrusted(event)) throw new Error("UNTRUSTED_WORKSPACE_REQUEST")
    return getStore().available()
  })
  ipcMain.handle("pigclaude:workspaces-worktree-projects", async (event) => {
    if (!input.isTrusted(event)) throw new Error("UNTRUSTED_WORKSPACE_REQUEST")
    return getWorktrees().projects()
  })
  ipcMain.handle("pigclaude:workspaces-add", async (event, value: unknown) => {
    if (!input.isTrusted(event)) throw new Error("UNTRUSTED_WORKSPACE_REQUEST")
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error("WORKSPACE_UNAVAILABLE: 工作区必须是绝对路径")
    }
    const before = await getStore().list()
    const next = await getStore().add(value)
    const added = next[0]
    if (added !== undefined && !before.includes(added)) await getNames().forget(added)
    return next
  })
  ipcMain.handle("pigclaude:workspaces-files", async (event, value: unknown) => {
    if (!input.isTrusted(event)) throw new Error("UNTRUSTED_WORKSPACE_REQUEST")
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error("WORKSPACE_UNAVAILABLE: 工作区必须是绝对路径")
    }
    return listWorkspaceFiles(value)
  })
  registerProjectIpc(ipcMain, {
    isTrusted: input.isTrusted,
    membership: input.membership,
    workspaces: getStore,
    names: getNames,
    reveal: (path) => settleOpenPath(shell.openPath(path)),
    apps: () => installedOpenApps(),
    openWith: async (app, folder) => {
      const launch = folderLaunch(app, folder)
      if (launch) return launchInFolder(launch.command, launch.args, folder)
      if ((await settleOpenPath(shell.openPath(folder))) !== "")
        throw new Error("PROJECT_OPEN_FAILED")
    },
  })
  input.workbench.register({
    isTrusted: input.isTrusted,
    membership: input.membership,
    hasActiveTurn: input.hasActiveTurn,
    roots: async () => {
      const projects = await getStore().list()
      return [...projects, ...(await getWorktrees().roots(projects))]
    },
    rememberWorktree: (path, from) => getWorktrees().remember(path, from),
  })
}
