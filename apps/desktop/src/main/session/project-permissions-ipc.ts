// 负责设置页的项目授权接口；登记和选择新规则由权限代理完成。

import type { IpcMain, IpcMainInvokeEvent } from "electron"
import type { ProjectPermissionEntry } from "../../project-permissions-contract"
import type { ProjectPermissionStore } from "./project-permission-store"

/** 设置页 IPC 需要的已信任窗口和本机授权库。 */
export type ProjectPermissionsIpcOptions = {
  getStore: () => Pick<ProjectPermissionStore, "list" | "revoke"> | null
  isTrusted: (event: IpcMainInvokeEvent) => boolean
}

/** 只允许可信窗口查看和撤销；会话尚未准备好或磁盘出错时返回固定错误。 */
export function registerProjectPermissionsIpc(
  ipc: Pick<IpcMain, "handle">,
  { getStore, isTrusted }: ProjectPermissionsIpcOptions,
): void {
  function handle(
    op: string,
    apply: (
      store: NonNullable<ReturnType<typeof getStore>>,
      id: unknown,
    ) => Promise<ProjectPermissionEntry[]>,
  ): void {
    ipc.handle(`pigclaude:project-permissions-${op}`, async (event, id: unknown) => {
      if (!isTrusted(event)) throw new Error("UNTRUSTED_SESSION_REQUEST")
      const store = getStore()
      if (store === null) throw new Error("PROJECT_PERMISSIONS_UNAVAILABLE")
      try {
        return await apply(store, id)
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_SESSION_INPUT") throw error
        throw new Error("PROJECT_PERMISSIONS_FAILED")
      }
    })
  }
  handle("list", (store) => store.list())
  handle("revoke", (store, id) => {
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
      throw new Error("INVALID_SESSION_INPUT")
    return store.revoke(id)
  })
}
