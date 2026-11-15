// 将市场缓存读取、来源管理及显式安装更新请求转发给受信主进程。

import { ipcRenderer } from "electron"
import {
  pluginMarketplaceChangedChannel,
  pluginMarketplaceChannelPrefix,
  type PluginMarketplaceBridge,
} from "../plugin-marketplace-contract"

/** 只暴露固定市场操作，订阅不向窗口交付原始 IPC 对象。 */
export function pluginMarketplaceBridge(): PluginMarketplaceBridge {
  const invoke = (name: string, ...args: unknown[]) =>
    ipcRenderer.invoke(pluginMarketplaceChannelPrefix + name, ...args)
  return {
    list: () => invoke("list"),
    selectDirectory: () => invoke("select-directory"),
    add: (input) => invoke("add", input),
    refresh: (sourceId) => invoke("refresh", sourceId),
    setEnabled: (sourceId, enabled) => invoke("set-enabled", sourceId, enabled),
    remove: (sourceId) => invoke("remove", sourceId),
    prepareInstall: (sourceId, entryId) => invoke("prepare-install", sourceId, entryId),
    prepareUpdate: (sourceId, entryId) => invoke("prepare-update", sourceId, entryId),
    subscribe(listener) {
      const receive = () => listener()
      ipcRenderer.on(pluginMarketplaceChangedChannel, receive)
      return () => {
        ipcRenderer.removeListener(pluginMarketplaceChangedChannel, receive)
      }
    },
  }
}
