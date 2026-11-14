// 注册会话历史与自动保留期命令，校验受信窗口和每项操作的输入。

import type { IpcMain, IpcMainInvokeEvent } from "electron"
import { isSessionRetentionDays } from "../../session-history-contract"
import type { SessionHost } from "./session-host"
import { isPlainRecord } from "./session-store-guards"
import { isSessionStoreId } from "./session-store-layout"

/** 注册已归档列表和会话变更，统一由调用方核验来源和提供宿主。 */
export function registerSessionHistoryIpc(
  ipc: Pick<IpcMain, "handle">,
  hostFor: (event: IpcMainInvokeEvent) => SessionHost,
): void {
  ipc.handle("pigclaude:session-list", async (event, value: unknown) => {
    const host = hostFor(event)
    const archived = value === undefined ? undefined : record(value).archived
    if (archived !== undefined && typeof archived !== "boolean") throw invalid()
    await host.ready()
    return host.list(archived)
  })
  ipc.handle("pigclaude:session-rename", async (event, value: unknown) => {
    const host = hostFor(event)
    const input = record(value)
    const title = typeof input.title === "string" ? input.title.trim() : ""
    if (title === "" || title.length > 200 || /\p{Cc}/u.test(title)) throw invalid()
    await host.history.rename(idOf(input), title)
  })
  ipc.handle("pigclaude:session-archive", async (event, value: unknown) => {
    const host = hostFor(event)
    const input = record(value)
    if (typeof input.archived !== "boolean") throw invalid()
    await host.history.archive(idOf(input), input.archived)
  })
  ipc.handle("pigclaude:session-delete", async (event, value: unknown) =>
    hostFor(event).history.delete(idOf(record(value))),
  )
  ipc.handle("pigclaude:session-data-stats", async (event) => hostFor(event).history.stats())
  ipc.handle("pigclaude:session-clear-history", async (event) => hostFor(event).history.clear())
  ipc.handle("pigclaude:session-retention", async (event) => hostFor(event).history.retention())
  ipc.handle("pigclaude:session-set-retention", async (event, value: unknown) => {
    const host = hostFor(event)
    const { days } = record(value)
    if (!isSessionRetentionDays(days)) throw invalid()
    return host.history.setRetention(days)
  })
}

function record(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) throw invalid()
  return value
}

function idOf(value: Record<string, unknown>): string {
  const { sessionId } = value
  if (typeof sessionId !== "string" || !isSessionStoreId(sessionId)) throw invalid()
  return sessionId
}

function invalid(): Error {
  return new Error("INVALID_SESSION_INPUT")
}
