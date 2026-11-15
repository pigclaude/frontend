// 将本机能力插件安装记录接到当前桌面的会员状态、沙箱和受信窗口事件。

import { app } from "electron"
import { join } from "node:path"
import type { MembershipState } from "@pigclaude/contracts/membership"
import { capabilityPluginsChangedChannel } from "../../capability-plugin-contract"
import type { DesktopComposition } from "../composition"
import { CapabilityPluginManager } from "./capability-plugin-manager"
import { readCapabilityPluginArchive } from "./plugin-archive"

/** 仅在沙箱宿主已装配时启用安装入口。源码运行态可以安装本地目录。 */
export function setupDesktopCapabilityPlugins(
  composition: DesktopComposition,
  send: (channel: string) => void,
) {
  const sandbox = composition.pluginSandbox
  if (!sandbox) return null
  const manager = new CapabilityPluginManager({
    root: join(app.getPath("userData"), "capability-plugins"),
    appVersion: app.getVersion(),
    membership: () => composition.membershipGate.view().state,
    developerMode: () => !app.isPackaged,
    readArchive: readCapabilityPluginArchive,
    stopInstances: (pluginId) => sandbox.stopInstances(pluginId),
  })
  return {
    manager,
    stopEvents: manager.subscribe(() => send(capabilityPluginsChangedChannel)),
    /** 推进插件的会员生命周期，清理异常使用固定诊断码。 */
    membershipChanged(state: MembershipState): void {
      void manager
        .membershipChanged(state)
        .catch(() => console.error("CAPABILITY_PLUGIN_LIFECYCLE_FAILED"))
    },
  }
}
