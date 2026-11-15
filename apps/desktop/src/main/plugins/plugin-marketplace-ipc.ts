// 将市场操作限制在可信主窗口，安装与更新沿用真实发送 frame 的一次性确认。

import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron"
import { pluginMarketplaceChannelPrefix } from "../../plugin-marketplace-contract"
import { pluginManagementError } from "./capability-plugin-ipc"
import type { PluginMarketplace } from "./plugin-marketplace"

/** 接入当前应用持有的市场和主窗口可信来源判定。 */
export function registerPluginMarketplaceIpc(options: {
  getMarketplace: () => PluginMarketplace | null
  isTrusted: (event: IpcMainInvokeEvent) => boolean
}): void {
  function handle(
    name: string,
    execute: (
      marketplace: PluginMarketplace,
      values: unknown[],
      event: IpcMainInvokeEvent,
      owner: object,
    ) => unknown,
  ): void {
    ipcMain.handle(pluginMarketplaceChannelPrefix + name, async (event, ...values: unknown[]) => {
      const owner = event.senderFrame
      if (!owner || !options.isTrusted(event)) throw new Error("UNTRUSTED_PLUGIN_REQUEST")
      const marketplace = options.getMarketplace()
      if (!marketplace) throw new Error("PLUGIN_MARKETPLACE_UNAVAILABLE")
      try {
        return await execute(marketplace, values, event, owner)
      } catch (cause: unknown) {
        throw pluginManagementError(cause)
      }
    })
  }

  handle("list", (marketplace) => marketplace.list())
  handle("select-directory", async (marketplace, _values, event) => {
    if (!(await marketplace.sources.list()).developerMode)
      throw new Error("PLUGIN_DEVELOPER_MODE_REQUIRED")
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error("PLUGIN_MARKETPLACE_UNAVAILABLE")
    const result = await dialog.showOpenDialog(window, {
      title: "选择本地市场目录",
      properties: ["openDirectory"],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  handle("add", (marketplace, [input]) => marketplace.sources.add(input))
  handle("refresh", (marketplace, [source, pin]) => {
    if (pin !== undefined && typeof pin !== "string")
      throw new Error("PLUGIN_MARKETPLACE_SOURCE_INVALID")
    return marketplace.sources.refresh(marketKey(source), pin)
  })
  handle("set-enabled", (marketplace, [source, enabled]) => {
    if (typeof enabled !== "boolean") throw new Error("PLUGIN_MARKETPLACE_SOURCE_INVALID")
    return marketplace.sources.setEnabled(marketKey(source), enabled)
  })
  handle("remove", (marketplace, [source]) => marketplace.sources.remove(marketKey(source)))
  handle("prepare-install", (marketplace, [source, entry], _event, owner) =>
    marketplace.prepareInstall(marketKey(source), marketKey(entry), owner),
  )
  handle("prepare-update", (marketplace, [source, entry], _event, owner) =>
    marketplace.prepareUpdate(marketKey(source), marketKey(entry), owner),
  )
}

function marketKey(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9._-]{1,128}$/i.test(value))
    throw new Error("PLUGIN_MARKETPLACE_SOURCE_INVALID")
  return value
}
