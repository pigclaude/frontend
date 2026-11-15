// 给可信设置页提供固定的能力插件管理命令与刷新事件。

import { ipcRenderer } from "electron"
import {
  capabilityPluginChannelPrefix,
  capabilityPluginsChangedChannel,
  type CapabilityPluginsBridge,
} from "../capability-plugin-contract"

/** 创建能力插件管理桥；所有来源和参数由主进程核验。 */
export function capabilityPluginsBridge(): CapabilityPluginsBridge {
  const invoke = (command: string, ...args: unknown[]) =>
    ipcRenderer.invoke(capabilityPluginChannelPrefix + command, ...args)
  return {
    status: () => invoke("status"),
    list: () => invoke("list"),
    pick: (kind) => invoke("pick", kind),
    prepare: (source) => invoke("prepare", source),
    confirm: (id) => invoke("confirm", id),
    cancel: (id) => invoke("cancel", id),
    setEnabled: (id, value) => invoke("set-enabled", id, value),
    setToolApproval: (id, mode) => invoke("set-tool-approval", id, mode),
    uninstall: (id, keepData) => invoke("uninstall", id, keepData),
    subscribe(listener) {
      const receive = () => listener()
      ipcRenderer.on(capabilityPluginsChangedChannel, receive)
      return () => ipcRenderer.removeListener(capabilityPluginsChangedChannel, receive)
    },
  }
}
