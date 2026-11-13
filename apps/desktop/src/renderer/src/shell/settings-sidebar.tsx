// 负责 PigClaude 的设置侧栏适配：分组、搜索和页面扩展点都来自 Pigcode 原语与注册表。
import { useMemo, useState } from "react"
import {
  contributionText,
  useContributions,
  type SettingsPageContribution,
} from "@pigclaude/client-runtime"
import { EmptyState, ListRow, SearchField, useLocale } from "@pigclaude/ui-primitives"
import { Icon } from "@pigclaude/ui-shell"
import { SideScroll } from "@pigclaude/ui-shell/side-scroll"
import { settingsNav } from "../models/settings-nav"

/** 设置侧栏需要的状态与事件；页面 id 来自设置页扩展点。 */
export type SettingsSidebarProps = {
  activePage: string
  onSelect: (page: string) => void
  onExit: () => void
}

/** 从设置扩展点读取页面，并按 PigClaude 的四个业务组绘制侧栏。 */
export function SettingsSidebar({ activePage, onSelect, onExit }: SettingsSidebarProps) {
  const { t } = useLocale()
  const [query, setQuery] = useState("")
  const pages = useContributions("settingsPage")
  const groups = useMemo(() => {
    const byId = new Map(pages.map((page) => [page.id, page]))
    const needle = query.trim().toLowerCase()
    return settingsNav
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          const page = byId.get(item.page)
          if (!page) return false
          if (!needle) return true
          return [item.label, ...item.keywords, contributionText(t, page.title)].some((text) =>
            text.toLowerCase().includes(needle),
          )
        }),
      }))
      .filter((group) => group.items.length > 0)
  }, [pages, query, t])

  const first = groups[0]?.items[0]?.page

  return (
    <>
      <div className="side-head">
        <ListRow
          render={<button type="button" />}
          className="nav-item back"
          onClick={onExit}
          leading={<Icon name="left" />}
          title={t("settings.back")}
        />
        <SearchField
          className="side-search"
          value={query}
          onValueChange={setQuery}
          placeholder={t("settings.search")}
          clearLabel={t("settings.clear")}
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("")
            if (event.key === "Enter" && first) onSelect(first)
          }}
        />
      </div>
      <SideScroll>
        {groups.length === 0 ? <EmptyState size="compact" title={t("settings.noMatches")} /> : null}
        {groups.map((group) => (
          <div key={group.label}>
            <div className="side-group">{group.label}</div>
            <nav className="side-nav" aria-label={group.label}>
              {group.items.map((item) => {
                const page = pages.find((candidate) => candidate.id === item.page)
                return page ? (
                  <SettingsRow
                    key={item.page}
                    page={page}
                    active={activePage === item.page}
                    onSelect={onSelect}
                    label={contributionText(t, page.title)}
                  />
                ) : null
              })}
            </nav>
          </div>
        ))}
      </SideScroll>
    </>
  )
}

/** 画单个扩展点页面的导航行。 */
function SettingsRow({
  page,
  active,
  onSelect,
  label,
}: {
  page: SettingsPageContribution
  active: boolean
  onSelect: (page: string) => void
  label: string
}) {
  const PageIcon = page.icon
  return (
    <ListRow
      render={<button type="button" />}
      className="nav-item"
      selected={active}
      aria-current={active ? "page" : undefined}
      onClick={() => onSelect(page.id)}
      leading={<PageIcon className="ic" aria-hidden="true" />}
      title={label}
    />
  )
}
