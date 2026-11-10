// 注册浏览器配置管理的产品入口，固定检测目标和数据路径只由主进程决定。

import { ipcMain, type IpcMainInvokeEvent } from "electron"
import { isClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import type { SaveBrowserProfileInput } from "@pigclaude/contracts/browser-profile"
import type { BrowserProfileService } from "./browser-profile-service"

/** 配置管理依赖，只信任当前主窗口发出的操作。 */
export type BrowserProfileIpcOptions = {
  getService: () => BrowserProfileService | null
  isTrusted: (event: IpcMainInvokeEvent) => boolean
}

/** 注册独立配置列表、保存、删除与按出口初始化，不接受任意 URL 或浏览器目录。 */
export function registerBrowserProfileIpc(options: BrowserProfileIpcOptions): void {
  const service = (event: IpcMainInvokeEvent): BrowserProfileService => {
    if (!options.isTrusted(event)) throw new Error("UNTRUSTED_REQUEST")
    const result = options.getService()
    if (!result) throw new Error("浏览器配置服务尚未准备好")
    return result
  }
  ipcMain.handle("pigclaude:browser-profiles-list", async (event) => service(event).list())
  ipcMain.handle("pigclaude:browser-profiles-save", async (event, value: unknown) =>
    service(event).save(readInput(value)),
  )
  ipcMain.handle("pigclaude:browser-profiles-remove", async (event, value: unknown) =>
    service(event).remove(readId(value)),
  )
  ipcMain.handle("pigclaude:browser-profiles-region", async (event, value: unknown) =>
    service(event).region(readId(value)),
  )
}

function readInput(value: unknown): SaveBrowserProfileInput {
  if (
    !record(value) ||
    typeof value.name !== "string" ||
    (value.proxyId !== null && typeof value.proxyId !== "string") ||
    !isClaudeFingerprintView(value.fingerprint)
  )
    throw new Error("浏览器配置参数不合法")
  if (
    value.browserDataId !== undefined ||
    value.browserProfileDir !== undefined ||
    value.url !== undefined
  )
    throw new Error("不接受浏览器路径或代理地址")
  const id = value.id === undefined ? undefined : readId(value.id)
  if (
    id &&
    (typeof value.revision !== "number" ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 1)
  )
    throw new Error("修改配置需要当前版本")
  return {
    ...(id ? { id, revision: value.revision as number } : {}),
    name: value.name,
    proxyId: value.proxyId,
    fingerprint: value.fingerprint,
  }
}

function readId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200)
    throw new Error("浏览器配置标识不合法")
  return value
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
