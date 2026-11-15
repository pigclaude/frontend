// 将缓存目录和物理插件文件接到安装确认，只有达成同一身份的包才可交给管理器。

import type { DesktopPluginInstallDisclosure } from "../../capability-plugin-contract"
import type {
  PluginMarketplaceEntryView,
  PluginMarketplaceUpdateResult,
  PluginMarketplaceView,
} from "../../plugin-marketplace-contract"
import type { CapabilityPluginManager } from "./capability-plugin-manager"
import { validateDesktopPluginBundle } from "./desktop-plugin-bundle"
import type { PluginMarketplaceInstallRequest } from "./desktop-plugin-installation"
import type { loadPluginMarketplaceEntry } from "./plugin-marketplace-source"
import type { PluginMarketplaceSources } from "./plugin-marketplace-sources"
import type { PluginMarketplaceThirdParty } from "./plugin-marketplace-third-party"

/** 市场页面可用的目录视图及显式的安装、更新入口。 */
export class PluginMarketplace {
  /** 读取器只提供有界正文，管理器为实际操作串行发布。 */
  constructor(
    readonly sources: PluginMarketplaceSources,
    private readonly manager: CapabilityPluginManager,
    private readonly loadEntry: typeof loadPluginMarketplaceEntry,
    private readonly appVersion: string,
    private readonly thirdParty: PluginMarketplaceThirdParty,
  ) {}

  /** 缓存的条目只显示主进程确定的可用操作。 */
  async list(): Promise<PluginMarketplaceView> {
    const installed = await this.manager.marketplaceInstallations()
    const directory = await this.sources.list()
    const thirdPartyEnabled = await this.thirdParty.enabled()
    return {
      developerMode: directory.developerMode,
      thirdPartyEnabled,
      sources: directory.sources,
      entries: (thirdPartyEnabled ? directory.entries : []).map(
        ({ sourceId, entry }): PluginMarketplaceEntryView => {
          const binding = installed.get(entry.info.id)
          const action =
            binding === undefined
              ? "install"
              : binding?.sourceId === sourceId && binding.entryId === entry.info.id
                ? "update"
                : "installed"
          return { ...entry.info, sourceId, action, reviewStatus: "unreviewed" }
        },
      ),
    }
  }

  /** 记录用户在可信窗口作出的选择。 */
  setThirdPartyEnabled(enabled: boolean): Promise<void> {
    return this.thirdParty.setEnabled(enabled)
  }

  /** 在第三方市场进入外部来源前和提交时核验同一次用户同意。 */
  authorizeThirdParty(): Promise<() => void> {
    return this.thirdParty.authorize()
  }

  /** 只有打开第三方市场后，才读取并添加新的用户来源。 */
  async add(input: unknown): Promise<void> {
    const validate = await this.authorizeThirdParty()
    validate()
    return this.sources.add(input)
  }

  /** 只有当前仍获用户授权才允许重读第三方来源。 */
  async refresh(sourceId: string, pin?: string): Promise<void> {
    const validate = await this.authorizeThirdParty()
    validate()
    return this.sources.refresh(sourceId, pin)
  }

  /** 加载和验证选中条目的同一份包，并交给主人窗口披露。 */
  async prepareInstall(
    sourceId: string,
    entryId: string,
    owner: object,
  ): Promise<DesktopPluginInstallDisclosure> {
    const validateOwner = this.manager.beginInstallReview(owner)
    return this.manager.prepareMarketplaceInstall(
      await this.#request(sourceId, entryId, validateOwner),
      owner,
    )
  }

  /** 手动检查已装插件，并依据新旧实际清单决定是否需要确认。 */
  async prepareUpdate(
    sourceId: string,
    entryId: string,
    owner: object,
  ): Promise<PluginMarketplaceUpdateResult> {
    const validateOwner = this.manager.beginInstallReview(owner)
    return this.manager.prepareMarketplaceUpdate(
      await this.#request(sourceId, entryId, validateOwner),
      owner,
    )
  }

  async #request(
    sourceId: string,
    entryId: string,
    validateOwner: () => void,
  ): Promise<PluginMarketplaceInstallRequest> {
    const validateConsent = await this.authorizeThirdParty()
    const selection = await this.sources.resolve(sourceId, entryId)
    const { input, entry } = selection
    validateConsent()
    const { files, ...provenance } = await this.loadEntry(input, entry)
    validateOwner()
    validateConsent()
    selection.assertCurrent()
    const bundle = validateDesktopPluginBundle(files, this.appVersion, entry.info.id)
    if (bundle.type !== entry.info.type || bundle.manifest.id !== entry.info.id)
      throw new Error("PLUGIN_MARKETPLACE_PACKAGE_MISMATCH")
    return {
      bundle,
      provenance: {
        ...provenance,
        sourceId,
        entryId,
        artifactDigest:
          entry.source.kind === "relative"
            ? provenance.digest
            : (provenance.archiveSha256 ?? provenance.digest),
      },
      requireFileReview: true,
      assertCurrent() {
        validateOwner()
        validateConsent()
        selection.assertCurrent()
      },
    }
  }
}
