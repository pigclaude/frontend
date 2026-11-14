// 注册最近工作区的读写入口和侧栏项目操作，仅允许受信的主窗口访问。

import { dirname, join } from "node:path"
import { ipcMain, shell } from "electron"
import type { MembershipView } from "@pigclaude/contracts/membership"
import { registerProjectIpc, settleOpenPath } from "./project-ipc"
import { ProjectNameStore } from "./project-names"
import { listWorkspaceFiles } from "./workspace-files"
import { WorkspaceStore } from "./workspace-store"
import type { WorkbenchIpc } from "../workbench/workbench-ipc"

/** 注册工作区入口并按需打开存储；写入只接受当前受信窗口的 frame。 */
export function registerWorkspaceIpc(input: {
  filePath: () => string
  isTrusted: (event: Electron.IpcMainInvokeEvent) => boolean
  workbench: WorkbenchIpc
  membership: () => MembershipView | undefined
  hasActiveTurn: () => boolean
}): void {
  let store: WorkspaceStore | null = null
  let names: ProjectNameStore | null = null
  const getStore = () => (store ??= new WorkspaceStore({ filePath: input.filePath() }))
  const getNames = () =>
    (names ??= new ProjectNameStore({
      filePath: join(dirname(input.filePath()), "project-names.json"),
    }))
  ipcMain.handle("pigclaude:workspaces-list", async (event) => {
    if (!input.isTrusted(event)) throw new Error("UNTRUSTED_WORKSPACE_REQUEST")
    return getStore().list()
  })
  ipcMain.handle("pigclaude:workspaces-add", async (event, value: unknown) => {
    if (!input.isTrusted(event)) throw new Error("UNTRUSTED_WORKSPACE_REQUEST")
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error("WORKSPACE_UNAVAILABLE: 工作区必须是绝对路径")
    }
    return getStore().add(value)
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
  })
  input.workbench.register({
    isTrusted: input.isTrusted,
    membership: input.membership,
    hasActiveTurn: input.hasActiveTurn,
    roots: () => getStore().list(),
  })
}
