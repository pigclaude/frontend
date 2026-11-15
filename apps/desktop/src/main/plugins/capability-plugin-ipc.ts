// 只允许可信主窗口选择来源、披露清单及确认安装，主进程操作不接收渲染层自报的权限或域名。

import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron"
import {
  capabilityPluginChannelPrefix,
  type CapabilityPluginInstallSource,
  type CapabilityPluginToolApproval,
  type CapabilityPluginRevision,
} from "../../capability-plugin-contract"
import type { CapabilityPluginDeclarationHost } from "./capability-plugin-declarations"
import type { CapabilityPluginManager } from "./capability-plugin-manager"

/** 主进程装配时提供当前管理器和可信窗口判定。 */
export type CapabilityPluginIpcOptions = {
  getManager: () => CapabilityPluginManager | null
  getDeclarations?: () => CapabilityPluginDeclarationHost | null
  isTrusted: (event: IpcMainInvokeEvent) => boolean
}

const visibleErrors = new Set([
  "MEMBERSHIP_REQUIRED",
  "PLUGIN_DEVELOPER_MODE_REQUIRED",
  "PLUGIN_CONFIRMATION_INVALID",
  "PLUGIN_SOURCE_INVALID",
  "PLUGIN_ID_INVALID",
  "PLUGIN_TOOL_APPROVAL_INVALID",
  "PLUGIN_ALREADY_INSTALLED",
  "PLUGIN_NOT_INSTALLED",
  "PLUGIN_DECLARATION_UNAVAILABLE",
  "PLUGIN_SETTING_INVALID",
  "PLUGIN_SECRET_STORAGE_UNAVAILABLE",
  "PLUGIN_EGRESS_UNAVAILABLE",
  "PLUGIN_API_UNSUPPORTED",
  "PLUGIN_VERSION_INCOMPATIBLE",
  "PLUGIN_MANIFEST_INVALID",
  "PLUGIN_DOMAIN_INVALID",
  "PLUGIN_BUNDLE_INVALID",
  "PLUGIN_BUNDLE_UNSAFE",
  "PLUGIN_BUNDLE_TOO_LARGE",
  "PLUGIN_RECORD_INVALID",
  "PLUGIN_ARCHIVE_INVALID",
  "PLUGIN_ARCHIVE_UNSAFE",
  "PLUGIN_ARCHIVE_TOO_LARGE",
  "PLUGIN_ARCHIVE_SHA256_INVALID",
  "PLUGIN_ARCHIVE_SHA256_MISMATCH",
  "PLUGIN_MARKETPLACE_UNAVAILABLE",
  "PLUGIN_MARKETPLACE_THIRD_PARTY_DISABLED",
  "PLUGIN_MARKETPLACE_CATALOG_INVALID",
  "PLUGIN_MARKETPLACE_SOURCE_INVALID",
  "PLUGIN_MARKETPLACE_SOURCE_UNAVAILABLE",
  "PLUGIN_MARKETPLACE_SOURCE_NOT_FOUND",
  "PLUGIN_MARKETPLACE_SOURCE_DISABLED",
  "PLUGIN_MARKETPLACE_SOURCE_CHANGED",
  "PLUGIN_MARKETPLACE_SOURCE_EXISTS",
  "PLUGIN_MARKETPLACE_ENTRY_NOT_FOUND",
  "PLUGIN_MARKETPLACE_ENTRY_UNAVAILABLE",
  "PLUGIN_MARKETPLACE_CACHE_INVALID",
  "PLUGIN_MARKETPLACE_REFRESH_FAILED",
  "PLUGIN_MARKETPLACE_INSTALLATION_MISMATCH",
  "PLUGIN_MARKETPLACE_PACKAGE_MISMATCH",
])

/** 对安装和市场请求只返回固定错误码，隐藏来源路径和传输错误正文。 */
export function pluginManagementError(cause: unknown): Error {
  const code = cause instanceof Error ? cause.message : ""
  return new Error(visibleErrors.has(code) ? code : "PLUGIN_MANAGEMENT_FAILED")
}

/** 注册固定的管理命令；披露与确认绑定到发送请求的同一个受信 frame。 */
export function registerCapabilityPluginIpc(options: CapabilityPluginIpcOptions): void {
  function handle(
    name: string,
    execute: (
      manager: CapabilityPluginManager,
      values: unknown[],
      event: IpcMainInvokeEvent,
      owner: object,
    ) => unknown,
  ): void {
    ipcMain.handle(capabilityPluginChannelPrefix + name, async (event, ...values: unknown[]) => {
      const owner = event.senderFrame
      if (!owner || !options.isTrusted(event)) throw new Error("UNTRUSTED_PLUGIN_REQUEST")
      const manager = options.getManager()
      if (!manager) throw new Error("PLUGIN_MANAGER_UNAVAILABLE")
      try {
        return await execute(manager, values, event, owner)
      } catch (cause: unknown) {
        throw pluginManagementError(cause)
      }
    })
  }

  function declarations() {
    const result = options.getDeclarations?.()
    if (!result) throw new Error("PLUGIN_MANAGER_UNAVAILABLE")
    return result
  }

  handle("status", (manager) => manager.status())
  handle("list", (manager) => manager.list())
  handle("list-declarations", () => declarations().list())
  handle("read-settings", (_manager, [plugin]) =>
    declarations().readSettings(pluginRevision(plugin)),
  )
  handle("set-setting", (_manager, [plugin, key, value]) =>
    declarations().setSetting(pluginRevision(plugin), declarationKey(key), value),
  )
  handle("run-command", (_manager, [plugin, commandId]) =>
    declarations().runCommand(pluginRevision(plugin), declarationKey(commandId)),
  )
  handle("pick", async (manager, [value], event) => {
    const kind = sourceKind(value)
    if (kind === "directory" && !manager.status().developerMode)
      throw new Error("PLUGIN_DEVELOPER_MODE_REQUIRED")
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error("PLUGIN_MANAGER_UNAVAILABLE")
    const result = await dialog.showOpenDialog(
      window,
      kind === "directory"
        ? { properties: ["openDirectory"], title: "选择插件目录" }
        : {
            properties: ["openFile"],
            title: "选择插件归档",
            filters: [{ name: "插件归档", extensions: ["zip", "tar", "gz", "tgz"] }],
          },
    )
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  handle("prepare", (manager, [value], _event, owner) => manager.prepare(source(value), owner))
  handle("confirm", (manager, [value], _event, owner) =>
    manager.confirm(confirmation(value), owner),
  )
  handle("cancel", (manager, [value], _event, owner) => manager.cancel(confirmation(value), owner))
  handle("set-enabled", (manager, [id, value]) => manager.setEnabled(idValue(id), boolean(value)))
  handle("set-tool-approval", (manager, [id, mode]) =>
    manager.setToolApproval(idValue(id), toolApproval(mode)),
  )
  handle("uninstall", (manager, [id, value]) => manager.uninstall(idValue(id), boolean(value)))
}

function pluginRevision(value: unknown): CapabilityPluginRevision {
  if (
    typeof value !== "object" ||
    value === null ||
    !("pluginId" in value) ||
    !("revision" in value) ||
    typeof value.revision !== "string" ||
    value.revision.length > 64
  )
    throw new Error("PLUGIN_DECLARATION_UNAVAILABLE")
  return { pluginId: idValue(value.pluginId), revision: value.revision }
}

function declarationKey(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64)
    throw new Error("PLUGIN_SETTING_INVALID")
  return value
}

function sourceKind(value: unknown): CapabilityPluginInstallSource["kind"] {
  if (value !== "directory" && value !== "archive") throw new Error("PLUGIN_SOURCE_INVALID")
  return value
}

function source(value: unknown): CapabilityPluginInstallSource {
  if (
    !value ||
    typeof value !== "object" ||
    !("kind" in value) ||
    !("path" in value) ||
    typeof value.path !== "string" ||
    value.path.length > 4_096
  )
    throw new Error("PLUGIN_SOURCE_INVALID")
  const kind = sourceKind(value.kind)
  if (kind === "directory") return { kind, path: value.path }
  if (!("sha256" in value) || typeof value.sha256 !== "string" || value.sha256.length !== 64)
    throw new Error("PLUGIN_ARCHIVE_SHA256_INVALID")
  return { kind, path: value.path, sha256: value.sha256 }
}

function confirmation(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/.test(value))
    throw new Error("PLUGIN_CONFIRMATION_INVALID")
  return value
}

function idValue(value: unknown): string {
  if (typeof value !== "string") throw new Error("PLUGIN_ID_INVALID")
  return value
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("PLUGIN_SOURCE_INVALID")
  return value
}

function toolApproval(value: unknown): CapabilityPluginToolApproval {
  if (value === "always_ask" || value === "follow_session") return value
  throw new Error("PLUGIN_TOOL_APPROVAL_INVALID")
}
