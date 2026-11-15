// 将本机能力插件安装记录接到当前桌面的会员状态、沙箱和受信窗口事件。

import { app, safeStorage, type IpcMainInvokeEvent } from "electron"
import { join } from "node:path"
import type { MembershipState } from "@pigclaude/contracts/membership"
import { capabilityPluginsChangedChannel } from "../../capability-plugin-contract"
import { capabilityPluginNoticeChannel } from "../../capability-plugin-notice-contract"
import { pluginMarketplaceChangedChannel } from "../../plugin-marketplace-contract"
import type { DesktopComposition } from "../composition"
import { createCapabilityPluginScope } from "./capability-plugin-capabilities"
import { CapabilityPluginDeclarationHost } from "./capability-plugin-declarations"
import { registerCapabilityPluginIpc } from "./capability-plugin-ipc"
import { CapabilityPluginManager, type CapabilityPluginSnapshot } from "./capability-plugin-manager"
import { CapabilityPluginNotices } from "./capability-plugin-notices"
import { createCapabilityPluginSecrets } from "./capability-plugin-secrets"
import { CapabilityPluginSettings } from "./capability-plugin-settings"
import { readCapabilityPluginArchive } from "./plugin-archive"
import { PluginMarketplace } from "./plugin-marketplace"
import { registerPluginMarketplaceIpc } from "./plugin-marketplace-ipc"
import {
  loadPluginMarketplaceCatalog,
  loadPluginMarketplaceEntry,
  normalizePluginMarketplaceSource,
} from "./plugin-marketplace-source"
import { PluginMarketplaceSources } from "./plugin-marketplace-sources"

/** 两种插件入口与市场都接受同一可信窗口来源。 */
export function registerDesktopPluginIpc(
  getPlugins: () => ReturnType<typeof setupDesktopCapabilityPlugins>,
  isTrusted: (event: IpcMainInvokeEvent) => boolean,
): void {
  registerCapabilityPluginIpc({
    getManager: () => getPlugins()?.manager ?? null,
    getDeclarations: () => getPlugins()?.declarations ?? null,
    isTrusted,
  })
  registerPluginMarketplaceIpc({
    getMarketplace: () => getPlugins()?.marketplace ?? null,
    isTrusted,
  })
}

/** 仅在沙箱宿主已装配时启用安装入口。源码运行态可以安装本地目录。 */
export function setupDesktopCapabilityPlugins(
  composition: DesktopComposition,
  send: (channel: string, payload?: unknown) => boolean,
) {
  const sandbox = composition.pluginSandbox
  if (!sandbox) return null
  const { runtime } = composition
  const userDataPath = app.getPath("userData")
  const root = join(userDataPath, "capability-plugins")
  const appVersion = app.getVersion()
  const membership = () => composition.membershipGate.view().state
  const developerMode = () => !app.isPackaged
  const manager = new CapabilityPluginManager({
    root,
    appVersion,
    membership,
    developerMode,
    readArchive: readCapabilityPluginArchive,
    stopInstances: (pluginId) => sandbox.stopInstances(pluginId),
  })
  const sources = new PluginMarketplaceSources({
    path: join(root, "marketplaces.json"),
    membership,
    developerMode,
    normalize: normalizePluginMarketplaceSource,
    load: loadPluginMarketplaceCatalog,
  })
  const marketplace = new PluginMarketplace(
    sources,
    manager,
    loadPluginMarketplaceEntry,
    appVersion,
  )
  const stopMarkets = sources.subscribe(() => send(pluginMarketplaceChangedChannel))
  const stopPlugins = manager.subscribe(() => {
    send(capabilityPluginsChangedChannel)
    send(pluginMarketplaceChangedChannel)
  })
  const secrets = createCapabilityPluginSecrets(root, safeStorage)
  const notices = new CapabilityPluginNotices((notice) =>
    send(capabilityPluginNoticeChannel, notice),
  )
  const capabilities = (
    snapshot: CapabilityPluginSnapshot,
    workspace: string | null,
    insertText?: (text: string) => boolean,
  ) =>
    createCapabilityPluginScope({
      snapshot,
      manager,
      secrets,
      userDataPath,
      workspace,
      notify: (message) => notices.show(snapshot.manifest.id, snapshot.manifest.name, message),
      ...(insertText === undefined ? {} : { insertText }),
    })
  const settings = new CapabilityPluginSettings(root, secrets)
  const declarations = new CapabilityPluginDeclarationHost({
    manager,
    settings,
    sandbox,
    runtime,
    active: () => membership() === "active",
    capabilities: (snapshot, insertText) => capabilities(snapshot, null, insertText),
  })
  return {
    manager,
    marketplace,
    sessionOptions: runtime
      ? {
          claudeCodePlugins: {
            stage: (directory: string) => manager.stageClaudeCodePlugins(directory),
            commands: () => manager.claudeCodePluginCommands(),
          },
          capabilityPluginTools: {
            manager,
            sandbox,
            pluginNetwork: runtime.pluginNetwork.bind(runtime),
            capabilities,
            async settings({ manifest, revision }: CapabilityPluginSnapshot, signal: AbortSignal) {
              if (!manifest.settings.some((field) => field.type !== "secret")) return undefined
              return manager.runCapability(manifest.id, revision, signal, () =>
                settings.values(manifest),
              )
            },
          },
        }
      : {},
    declarations,
    /** 卸下安装和市场缓存订阅。 */
    stopEvents(): void {
      stopMarkets()
      stopPlugins()
    },
    /** 推进插件的会员生命周期，清理异常使用固定诊断码。 */
    membershipChanged(state: MembershipState): void {
      sources.membershipChanged(state)
      void manager
        .membershipChanged(state)
        .catch(() => console.error("CAPABILITY_PLUGIN_LIFECYCLE_FAILED"))
    },
  }
}
