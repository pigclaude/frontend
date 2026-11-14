// 负责侧栏项目操作的 IPC：显示名、重命名、从侧栏移除、在文件管理器中显示。
// 只操作最近工作区里登记过的项目；移除只改列表，不删除任何文件。

import type { IpcMain, IpcMainInvokeEvent } from "electron"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { ProjectNameStore } from "./project-names"
import type { WorkspaceStore } from "./workspace-store"

/** 项目操作的依赖；存储按需打开，reveal 返回空串表示已打开，否则是系统给的错误说明。 */
export type ProjectIpcOptions = {
  isTrusted: (event: IpcMainInvokeEvent) => boolean
  membership: () => MembershipView | undefined
  workspaces: () => Pick<WorkspaceStore, "list" | "remove">
  names: () => Pick<ProjectNameStore, "names" | "rename" | "forget">
  reveal: (path: string) => Promise<string>
}

const knownErrors = /^(PROJECT_NOT_FOUND|PROJECT_NAME_INVALID|PROJECT_OPEN_FAILED)$/

/**
 * 注册 `pigclaude:projects-*`。所有入口只接受受信主窗口；改动类入口还要求会员有效。
 * 失败时只抛出登记过的错误码，不把路径或系统错误原文交给页面。
 */
export function registerProjectIpc(ipc: Pick<IpcMain, "handle">, options: ProjectIpcOptions): void {
  function handle(
    name: string,
    action: (args: unknown[]) => Promise<unknown>,
    needsMembership = true,
  ): void {
    ipc.handle(`pigclaude:projects-${name}`, async (event, ...args: unknown[]) => {
      if (!options.isTrusted(event)) throw new Error("UNTRUSTED_WORKSPACE_REQUEST")
      if (needsMembership && options.membership()?.state !== "active") {
        throw new Error("MEMBERSHIP_REQUIRED")
      }
      try {
        return await action(args)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : ""
        throw new Error(knownErrors.test(message) ? message : "PROJECT_OPERATION_FAILED")
      }
    })
  }

  async function registered(value: unknown): Promise<{ path: string; projects: string[] }> {
    const projects = await options.workspaces().list()
    if (typeof value !== "string" || !projects.includes(value)) {
      throw new Error("PROJECT_NOT_FOUND")
    }
    return { path: value, projects }
  }

  handle("names", async () => options.names().names(await options.workspaces().list()), false)
  handle("rename", async ([path, name]) => {
    const project = await registered(path)
    if (typeof name !== "string") throw new Error("PROJECT_NAME_INVALID")
    return options.names().rename(project.path, name, project.projects)
  })
  handle("remove", async ([path]) => {
    const project = await registered(path)
    const next = await options.workspaces().remove(project.path)
    await options.names().forget(project.path)
    return next
  })
  handle("reveal", async ([path]) => {
    const project = await registered(path)
    if ((await options.reveal(project.path)) !== "") throw new Error("PROJECT_OPEN_FAILED")
  })
}
