// 展示插件市场的目录分段、搜索以及前往来源和管理页的入口。

import { Plus, RefreshCw, Store } from "lucide-react"
import { Button, SearchField, SegmentedControl } from "@pigclaude/ui-primitives"
import { useText } from "../../locale/text"

type MarketplaceScope = "public" | "community" | "personal"

/** 记录当前来源分段和在该分段内查找的文字。 */
export type MarketplaceBrowse = { scope: MarketplaceScope; query: string }

/** 市场页头把来源操作和独立的插件管理入口放在同一行。 */
export function PluginMarketplaceHeader({
  canRefresh,
  canOpenSources,
  canAdd,
  onRefresh,
  onOpenSources,
  onAdd,
  onOpenManagement,
}: {
  canRefresh: boolean
  canOpenSources: boolean
  canAdd: boolean
  onRefresh: () => void
  onOpenSources: () => void
  onAdd: () => void
  onOpenManagement: () => void
}) {
  const { t } = useText()
  return (
    <header className="page-head plugins-header">
      <h1 id="plugins-heading">{t("pluginMarketplace.catalog")}</h1>
      <div className="actions plugins-header-actions">
        <Button
          type="button"
          size="icon"
          disabled={!canRefresh}
          aria-label={t("pluginMarketplace.refreshAll")}
          title={t("pluginMarketplace.refreshAll")}
          onClick={onRefresh}
        >
          <RefreshCw className="ic ic-sm" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon"
          disabled={!canOpenSources}
          aria-label={t("pluginMarketplace.sources")}
          title={t("pluginMarketplace.sources")}
          onClick={onOpenSources}
        >
          <Store className="ic ic-sm" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          disabled={!canAdd}
          title={t("pluginMarketplace.addSource")}
          onClick={onAdd}
        >
          <Plus className="ic ic-sm" aria-hidden="true" />
          {t("pluginMarketplace.add")}
        </Button>
        <Button type="button" variant="primary" onClick={onOpenManagement}>
          {t("pluginSettings.manage")}
        </Button>
      </div>
    </header>
  )
}

/** 展示当前目录分段，搜索范围随分段变化。 */
export function PluginMarketplaceBrowseBar({
  browse,
  disabled,
  onChange,
}: {
  browse: MarketplaceBrowse
  disabled: boolean
  onChange: (browse: MarketplaceBrowse) => void
}) {
  const { t } = useText()
  return (
    <div className="market-toolbar plugins-toolbar">
      <SegmentedControl<MarketplaceScope>
        className="plugin-marketplace-switcher"
        aria-label={t("pluginMarketplace.view")}
        value={browse.scope}
        disabled={disabled}
        onValueChange={(scope) => onChange({ ...browse, scope })}
        options={[
          { value: "public", label: t("pluginMarketplace.public") },
          { value: "community", label: t("pluginMarketplace.community") },
          { value: "personal", label: t("pluginMarketplace.personal") },
        ]}
      />
      <SearchField
        className="market-search control-xl"
        value={browse.query}
        onValueChange={(query) => onChange({ ...browse, query })}
        placeholder={t("pluginMarketplace.search")}
        clearLabel={t("pluginSettings.clearSearch")}
      />
    </div>
  )
}
