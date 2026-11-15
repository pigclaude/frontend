// 将缓存目录和物理插件文件接到安装确认，只有达成同一身份的包才可交给管理器。

import type { DesktopPluginInstallDisclosure } from "../../capability-plugin-contract"
import type {
  PluginMarketplaceEntryView,
  PluginMarketplaceSourceView,
  PluginMarketplaceUpdateResult,
  PluginMarketplaceView,
} from "../../plugin-marketplace-contract"
import type { CapabilityPluginManager } from "./capability-plugin-manager"
import { validateDesktopPluginBundle } from "./desktop-plugin-bundle"
import type { PluginMarketplaceInstallRequest } from "./desktop-plugin-installation"
import type { MarketplacePluginRevocationNotice } from "./marketplace-plugin-revocations"
import {
  officialPluginMarketplaceId,
  type OfficialPluginMarketplace,
} from "./official-plugin-marketplace"
import type { OfficialPluginMarketplaceCatalog } from "./official-plugin-marketplace-verification"
import type {
  PluginMarketplaceCatalogEntry,
  PluginMarketplaceProvenance,
} from "./plugin-marketplace-catalog"
import type { loadPluginMarketplaceEntry } from "./plugin-marketplace-source"
import type { PluginMarketplaceSources } from "./plugin-marketplace-sources"
import type { PluginMarketplaceThirdParty } from "./plugin-marketplace-third-party"

type OfficialMarketplace = {
  cache: Pick<OfficialPluginMarketplace, "get" | "refresh" | "resolve">
  changed(): void
  announceRevocation(notice: MarketplacePluginRevocationNotice): void
}

type OfficialSnapshot = NonNullable<Awaited<ReturnType<OfficialMarketplace["cache"]["get"]>>>

/** 市场页面可用的目录视图及显式的安装、更新入口。 */
export class PluginMarketplace {
  #officialError: string | null = null
  #officialRefresh: Promise<void> | undefined

  /** 读取器只提供有界正文，管理器为实际操作串行发布。 */
  constructor(
    readonly sources: PluginMarketplaceSources,
    private readonly manager: CapabilityPluginManager,
    private readonly loadEntry: typeof loadPluginMarketplaceEntry,
    private readonly appVersion: string,
    private readonly thirdParty: PluginMarketplaceThirdParty,
    private readonly official?: OfficialMarketplace,
  ) {}

  /** 缓存的条目只显示主进程确定的可用操作。 */
  async list(): Promise<PluginMarketplaceView> {
    const installed = await this.manager.marketplaceInstallations()
    const official = await this.#readOfficial()
    const directory = await this.sources.list().catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== "PLUGIN_MARKETPLACE_CACHE_INVALID")
        throw error
      return { developerMode: false, sources: [], entries: [], thirdPartyError: error.message }
    })
    const thirdPartyEnabled = await this.thirdParty.enabled()
    return {
      developerMode: directory.developerMode,
      thirdPartyEnabled,
      ...("thirdPartyError" in directory ? { thirdPartyError: directory.thirdPartyError } : {}),
      sources: this.official
        ? [this.#officialSource(official), ...directory.sources]
        : directory.sources,
      entries: [
        ...officialEntries(official?.verified, installed),
        ...(thirdPartyEnabled ? directory.entries : []).map(({ sourceId, entry }) =>
          marketplaceEntry(entry, sourceId, installed, "unreviewed"),
        ),
      ],
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
    if (sourceId === officialPluginMarketplaceId && this.official) {
      if (pin !== undefined) throw new Error("PLUGIN_MARKETPLACE_SOURCE_INVALID")
      this.#officialRefresh ??= this.#refreshOfficial().finally(() => {
        this.#officialRefresh = undefined
      })
      await this.#officialRefresh
      return
    }
    const validate = await this.authorizeThirdParty()
    validate()
    return this.sources.refresh(sourceId, pin)
  }

  /** 恢复已验证目录的吊销，在启动会话服务前把权限应用到安装记录。 */
  async reconcileCachedOfficialRevocations(): Promise<void> {
    const snapshot = await this.#readOfficial()
    if (snapshot) await this.#applyRevocations(snapshot.verified)
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
    const official = sourceId === officialPluginMarketplaceId ? this.official : undefined
    const validateConsent = official ? () => undefined : await this.authorizeThirdParty()
    const selection = official
      ? await official.cache.resolve(entryId)
      : await this.sources.resolve(sourceId, entryId)
    const { input, entry } = selection
    validateConsent()
    const { files, ...provenance } = await this.loadEntry(input, entry)
    validateOwner()
    validateConsent()
    selection.assertCurrent()
    if (
      official &&
      (entry.source.kind !== "github" ||
        entry.expectedSha256 === null ||
        provenance.repo !== entry.source.repo ||
        provenance.commit !== entry.source.commit ||
        provenance.archiveSha256 !== entry.expectedSha256)
    )
      throw new Error("PLUGIN_MARKETPLACE_OFFICIAL_PACKAGE_MISMATCH")
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
      ...(official ? {} : { requireFileReview: true as const }),
      assertCurrent() {
        validateOwner()
        validateConsent()
        selection.assertCurrent()
      },
    }
  }

  async #readOfficial(): Promise<OfficialSnapshot | null> {
    if (!this.official) return null
    try {
      return await this.official.cache.get()
    } catch (error) {
      this.#officialError = officialErrorCode(error)
      return null
    }
  }

  #officialSource(snapshot: OfficialSnapshot | null): PluginMarketplaceSourceView {
    return {
      id: officialPluginMarketplaceId,
      kind: "official",
      label: "pigclaude/plugs",
      catalogName: snapshot?.verified.catalog.name ?? officialPluginMarketplaceId,
      enabled: true,
      refreshedAt: snapshot?.refreshedAt ?? null,
      pin: snapshot?.commit ?? null,
      entryCount: snapshot?.verified.catalog.entries.length ?? 0,
      error: this.#officialError,
    }
  }

  async #refreshOfficial(): Promise<void> {
    if (!this.official) return
    try {
      const snapshot = await this.official.cache.refresh()
      await this.#applyRevocations(snapshot.verified)
      this.#officialError = null
    } catch (error) {
      this.#officialError = officialErrorCode(error)
      throw error
    } finally {
      this.official.changed()
    }
  }

  async #applyRevocations(verified: OfficialPluginMarketplaceCatalog): Promise<void> {
    const notices = await this.manager.applyMarketplaceRevocations(
      officialPluginMarketplaceId,
      verified.revoked,
    )
    for (const notice of notices) this.official?.announceRevocation(notice)
  }
}

function officialErrorCode(error: unknown): string {
  return error instanceof Error && /^PLUGIN_MARKETPLACE_OFFICIAL_[A-Z_]+$/.test(error.message)
    ? error.message
    : "PLUGIN_MARKETPLACE_OFFICIAL_UNAVAILABLE"
}

function marketplaceEntry(
  entry: PluginMarketplaceCatalogEntry,
  sourceId: string,
  installed: ReadonlyMap<string, PluginMarketplaceProvenance | null>,
  reviewStatus: PluginMarketplaceEntryView["reviewStatus"],
): PluginMarketplaceEntryView {
  const binding = installed.get(entry.info.id)
  const action =
    binding === undefined
      ? "install"
      : binding?.sourceId === sourceId && binding.entryId === entry.info.id
        ? "update"
        : "installed"
  return { ...entry.info, sourceId, action, reviewStatus }
}

function officialEntries(
  catalog: OfficialPluginMarketplaceCatalog | undefined,
  installed: ReadonlyMap<string, PluginMarketplaceProvenance | null>,
): PluginMarketplaceEntryView[] {
  if (!catalog) return []
  const expired = Date.parse(catalog.expiresAt) <= Date.now()
  return catalog.catalog.entries.map((entry) => {
    const view = marketplaceEntry(entry, officialPluginMarketplaceId, installed, "reviewed")
    const { source } = entry
    if (
      source.kind === "github" &&
      catalog.revoked.some(
        ({ name, repo, sha }) =>
          name === entry.info.id &&
          repo === source.repo &&
          (sha === undefined || sha === source.commit),
      )
    )
      return { ...view, action: "blocked", blockedBy: "revoked" }
    if (expired && view.action !== "installed")
      return { ...view, action: "blocked", blockedBy: "expired" }
    return view
  })
}
