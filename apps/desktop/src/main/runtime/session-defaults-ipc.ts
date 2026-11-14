// 负责新会话默认设置的 IPC：读取和修改 session-defaults.json，只接受受信主窗口。
// 这里只存本机偏好，不调用 Claude 也不动账号，所以不要求会员有效；启动会话时仍按会员校验。

import type { IpcMain, IpcMainInvokeEvent } from "electron"
import { readSessionDefaultsPatch, type SessionDefaults } from "../../session-defaults-contract"
import type { SessionDefaultsStore } from "./session-defaults"

/** 默认设置入口的依赖；存储按需打开。 */
export type SessionDefaultsIpcOptions = {
  isTrusted: (event: IpcMainInvokeEvent) => boolean
  store: () => Pick<SessionDefaultsStore, "get" | "update">
}

/**
 * 注册 `pigclaude:session-defaults-get` 和 `pigclaude:session-defaults-set`。
 * 修改先校验再写；失败只抛 SESSION_DEFAULTS_INVALID 或 SESSION_DEFAULTS_FAILED，不把文件路径交给页面。
 */
export function registerSessionDefaultsIpc(
  ipc: Pick<IpcMain, "handle">,
  options: SessionDefaultsIpcOptions,
): void {
  function handle(name: string, action: (args: unknown[]) => Promise<SessionDefaults>): void {
    ipc.handle(`pigclaude:session-defaults-${name}`, async (event, ...args: unknown[]) => {
      if (!options.isTrusted(event)) throw new Error("UNTRUSTED_SESSION_DEFAULTS_REQUEST")
      try {
        return await action(args)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : ""
        throw new Error(
          message === "SESSION_DEFAULTS_INVALID" ? message : "SESSION_DEFAULTS_FAILED",
        )
      }
    })
  }

  handle("get", () => options.store().get())
  handle("set", async ([patch]) => options.store().update(readSessionDefaultsPatch(patch)))
}
