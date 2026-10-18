// 负责迁入固定 Pigcursor 200px 粘性设置分组导航，仅保留安全风控。
import { Settings2, ShieldCheck, type LucideIcon } from "lucide-react"
import { cn } from "@pigclaude/web-ui/lib/utils"
interface PanelDef {
  id: string
  title: string
}

// 面板图标：按 settings-spec 的面板 id 登记；未登记的新面板回落到通用齿轮图标（导航与面板头共用）。
export function panelIcon(id: string): LucideIcon {
  return PANEL_ICONS[id] ?? Settings2
}

const PANEL_ICONS: Record<string, LucideIcon> = { security: ShieldCheck }

interface SettingsNavProps {
  panels: PanelDef[]
  active: string
  /** 当前面板有未保存修改时，在其导航项右侧显示强调色圆点。 */
  activeDirty?: boolean
  onSelect: (id: string) => void
}

/**
 * 左侧分组导航：200px 粘性列，点击切面板（`active` 高亮）。
 * 窄屏退化为横向可滚动的胶囊条。
 */
export function SettingsNav({ panels, active, activeDirty = false, onSelect }: SettingsNavProps) {
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:sticky md:top-[84px] md:mx-0 md:w-[200px] md:shrink-0 md:flex-col md:gap-0.5 md:overflow-visible md:px-0 md:pb-0">
      {panels.map((p) => {
        const Icon = panelIcon(p.id)
        const selected = active === p.id
        return (
          <button
            key={p.id}
            type="button"
            data-panel={p.id}
            aria-current={selected ? "page" : undefined}
            onClick={() => onSelect(p.id)}
            className={cn(
              "group relative flex h-8 shrink-0 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] font-medium whitespace-nowrap text-fg-2 transition-colors outline-none hover:bg-raise-2 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30",
              selected &&
                "bg-[var(--nav-active)] text-foreground shadow-[var(--nav-active-shadow)] hover:bg-[var(--nav-active)]",
            )}
          >
            <Icon
              className={cn(
                "size-4 shrink-0 text-meta transition-colors group-hover:text-fg-2",
                selected && "text-accent-ink group-hover:text-accent-ink",
              )}
            />
            {p.title}
            {selected && activeDirty && (
              <span
                aria-label="有未保存的修改"
                className="ml-auto size-1.5 shrink-0 rounded-full bg-primary"
              />
            )}
          </button>
        )
      })}
    </nav>
  )
}
