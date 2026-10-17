// 负责绘制设置页面的搜索框和分组导航。
import { useState } from "react"
import { Icon } from "./icon"
import { Input } from "./ui/input"
import { filterSettingsNav, settingsNav } from "../models/settings-nav"
import type { Screen } from "../screens/screen"
import { Button } from "./ui/button"

/** 绘制设置侧栏，搜索只过滤导航，不改变当前页面。 */
export function SettingsSidebar({
  screen,
  onNavigate,
  onExit,
}: {
  screen: Screen
  onNavigate: (screen: Screen) => void
  onExit: () => void
}) {
  const [query, setQuery] = useState("")
  const groups = filterSettingsNav(settingsNav, query)
  return (
    <>
      <Button variant="plain" className="nav-item back" type="button" onClick={onExit}>
        <Icon name="left" />
        返回应用
      </Button>
      <label className="side-search">
        <Icon name="search" small />
        <Input
          type="search"
          placeholder="搜索设置"
          aria-label="搜索设置"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("")
            const first = groups[0]?.items[0]
            if (event.key === "Enter" && first) onNavigate(first.screen)
          }}
        />
        {query ? (
          <Button
            variant="plain"
            className="side-search-clear"
            type="button"
            aria-label="清除搜索"
            onClick={() => setQuery("")}
          >
            <Icon name="x" small />
          </Button>
        ) : null}
      </label>
      {groups.length === 0 ? <p className="side-empty-hit">没有匹配的设置</p> : null}
      {groups.map((group) => (
        <div key={group.label} role="group" aria-label={group.label}>
          <div className="side-group">{group.label}</div>
          {group.items.map((item) => (
            <Button
              variant="plain"
              key={item.screen}
              className={screen === item.screen ? "nav-item is-active" : "nav-item"}
              type="button"
              aria-current={screen === item.screen ? "page" : undefined}
              onClick={() => onNavigate(item.screen)}
            >
              <Icon name={item.icon} />
              {item.label}
            </Button>
          ))}
        </div>
      ))}
    </>
  )
}
