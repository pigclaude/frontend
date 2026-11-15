// 给可信主界面投影已启用的贡献，并将用户命令送到隔离沙箱。
import type {
  CapabilityPluginCommandResult,
  CapabilityPluginDeclarations,
  CapabilityPluginRevision,
  CapabilityPluginSettingsView,
} from "../../capability-plugin-contract"
import type { LocalRuntime } from "../runtime/local-runtime"
import type { CapabilityPluginManager } from "./capability-plugin-manager"
import type { CapabilityPluginSettings } from "./capability-plugin-settings"
import { capabilityPluginToolName } from "./capability-plugin-tool-name"
import type { PluginSandboxHost } from "./plugin-sandbox-host"

type Options = {
  manager: CapabilityPluginManager
  settings: CapabilityPluginSettings
  sandbox: Pick<PluginSandboxHost, "invoke">
  runtime: Pick<LocalRuntime, "pluginNetwork"> | null
  active: () => boolean
}

/** 在主进程执行业务授权；主窗口只接收声明、普通值和许可的草稿插入结果。 */
export class CapabilityPluginDeclarationHost {
  /** 连接安装记录、设置和命令需要的隔离运行时。 */
  constructor(private readonly options: Options) {}

  /** 提供当前可用的命令和工具模板，模板精确匹配会话工具桥的名字。 */
  async list(): Promise<CapabilityPluginDeclarations[]> {
    if (!this.options.active()) return []
    const plugins = await this.options.manager.list()
    if (!this.options.active()) return []
    return plugins
      .filter((plugin) => plugin.enabled && plugin.compatible)
      .map(({ manifest, revision }) => ({
        pluginId: manifest.id,
        revision,
        commands: manifest.commands,
        toolResults: manifest.toolResultTemplates.map(({ tool, template }) => ({
          toolName: capabilityPluginToolName(manifest.id, tool),
          template,
        })),
      }))
  }

  /** 只有当前启用版本可读到它的普通设置和密钥状态。 */
  readSettings(plugin: CapabilityPluginRevision): Promise<CapabilityPluginSettingsView> {
    return this.options.manager.withEnabledPlugin(plugin, ({ manifest }) =>
      this.options.settings.read(manifest),
    )
  }

  /** 校验当前安装版本的字段和类型，串行保存一个值。 */
  setSetting(
    plugin: CapabilityPluginRevision,
    key: string,
    value: unknown,
  ): Promise<CapabilityPluginSettingsView> {
    return this.options.manager.withEnabledPlugin(plugin, ({ manifest }) =>
      this.options.settings.set(manifest, key, value),
    )
  }

  /** 在会话外执行一次用户触发的命令。停用或卸载后不返回该命令的编辑效果。 */
  async runCommand(
    plugin: CapabilityPluginRevision,
    commandId: string,
  ): Promise<CapabilityPluginCommandResult> {
    const { manager, runtime, sandbox } = this.options
    const snapshot = await manager.commandSnapshot(plugin, commandId)
    const { manifest, modules, revision, approvedDomains } = snapshot
    const usesNetwork = manifest.permissions.includes("network") && approvedDomains.length > 0
    if (usesNetwork && !runtime) throw new Error("PLUGIN_EGRESS_UNAVAILABLE")
    const network = usesNetwork
      ? await runtime?.pluginNetwork(null, {
          declaredDomains: manifest.networkDomains,
          approvedDomains,
        })
      : undefined

    const settings = await manager.withEnabledPlugin(plugin, () =>
      manifest.settings.some((field) => field.type !== "secret")
        ? this.options.settings.values(manifest)
        : null,
    )
    const result = await sandbox.invoke(
      {
        pluginId: manifest.id,
        revision,
        modules,
        entry: manifest.entry,
        egressId: network?.egressId ?? "system",
        ...(network === undefined ? {} : { network }),
      },
      { operation: "command:" + commandId, input: settings === null ? null : { settings } },
    )
    return manager.withEnabledPlugin(plugin, () => {
      if (
        !manifest.permissions.includes("composer-insert") ||
        typeof result !== "object" ||
        result === null ||
        !("insertText" in result) ||
        typeof result.insertText !== "string" ||
        result.insertText.length === 0 ||
        result.insertText.length > 16_384
      )
        return { insertText: null }
      return { insertText: result.insertText }
    })
  }
}
