// 负责主题下拉：触发器显示强调色「Aa」、主题名和「· 已修改」；菜单里是内置主题、我的主题和导入/另存/还原。
import type { KeyboardEvent, MouseEvent } from "react"
import { Icon } from "../../../components/icon"
import { Button } from "../../../components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu"
import type { Hex } from "../../../models/color-math"
import { pigclaudeColors, type Tone } from "../../../models/theme-editing"
import { builtInThemes, type ThemeDefinition } from "../../../models/theme-presets"

/** 主题下拉的参数。tone 决定色卡用哪个模式的颜色。 */
export type ThemeMenuProps = {
  tone: Tone
  current: ThemeDefinition
  accent: Hex
  modified: boolean
  customThemes: readonly ThemeDefinition[]
  onSelect: (id: string) => void
  onImport: () => void
  onSaveAs: () => void
  onRestore: () => void
  onRename: (theme: ThemeDefinition) => void
  onRemove: (theme: ThemeDefinition) => void
}

function Chip({ theme, tone }: { theme: ThemeDefinition; tone: Tone }) {
  const colors = theme[tone] ?? pigclaudeColors[tone]
  return (
    <span className="theme-chip" aria-hidden="true">
      <span style={{ backgroundColor: colors.bg }} />
      <span style={{ backgroundColor: colors.accent ?? pigclaudeColors[tone].accent }} />
      <span style={{ backgroundColor: colors.fg }} />
    </span>
  )
}

function ThemeItem({
  theme,
  tone,
  active,
  onSelect,
  actions,
}: {
  theme: ThemeDefinition
  tone: Tone
  active: boolean
  onSelect: (id: string) => void
  actions?: { onRename: () => void; onRemove: () => void }
}) {
  // 只拦 click：pointerdown 照常冒泡，Radix 才知道指针是在菜单项里按下的，不会在 pointerup 时替我们选中主题
  const stop = (run: () => void) => (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    run()
  }
  // 键盘：高亮「我的主题」某项时按 F2 重命名、按 Delete 或 Backspace 删除（先弹确认）
  const onKeyDown = (event: KeyboardEvent) => {
    if (!actions) return
    if (event.key === "F2") {
      event.preventDefault()
      actions.onRename()
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault()
      actions.onRemove()
    }
  }
  return (
    <DropdownMenuItem
      className="theme-item"
      aria-keyshortcuts={actions ? "F2 Delete" : undefined}
      onKeyDown={onKeyDown}
      onSelect={() => onSelect(theme.id)}
    >
      <Chip theme={theme} tone={tone} />
      <span className="theme-item-name">{theme.name}</span>
      {actions ? (
        // 只给鼠标用的快捷按钮：不进 Tab 顺序、对读屏隐藏，键盘走菜单项上的 F2 / Delete
        <span className="theme-item-actions" aria-hidden="true">
          <Button
            variant="ghost"
            size="icon"
            className="theme-item-action"
            tabIndex={-1}
            aria-label={`重命名 ${theme.name}`}
            title="重命名（F2）"
            onClick={stop(actions.onRename)}
          >
            <Icon name="pencil" small />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="theme-item-action"
            tabIndex={-1}
            aria-label={`删除 ${theme.name}`}
            title="删除（Delete）"
            onClick={stop(actions.onRemove)}
          >
            <Icon name="trash" small />
          </Button>
        </span>
      ) : null}
      {active ? (
        <span className="check-mark">
          <Icon name="check" small />
        </span>
      ) : null}
    </DropdownMenuItem>
  )
}

/** 渲染主题下拉。选主题、导入、另存、还原、重命名和删除都交给调用方处理。 */
export function ThemeMenu({
  tone,
  current,
  accent,
  modified,
  customThemes,
  onSelect,
  onImport,
  onSaveAs,
  onRestore,
  onRename,
  onRemove,
}: ThemeMenuProps) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button className="theme-trigger" aria-label={`主题 ${current.name}`}>
          <span className="theme-aa" style={{ color: accent }}>
            Aa
          </span>
          <span className="theme-trigger-name">
            {current.name}
            {modified ? <span className="theme-modified"> · 已修改</span> : null}
          </span>
          <Icon name="updown" className="chev" small />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="theme-menu">
        <DropdownMenuLabel>内置主题</DropdownMenuLabel>
        {builtInThemes.map((theme) => (
          <ThemeItem
            key={theme.id}
            theme={theme}
            tone={tone}
            active={theme.id === current.id}
            onSelect={onSelect}
          />
        ))}
        {customThemes.length > 0 ? (
          <>
            <DropdownMenuLabel>我的主题</DropdownMenuLabel>
            {customThemes.map((theme) => (
              <ThemeItem
                key={theme.id}
                theme={theme}
                tone={tone}
                active={theme.id === current.id}
                onSelect={onSelect}
                actions={{ onRename: () => onRename(theme), onRemove: () => onRemove(theme) }}
              />
            ))}
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onImport}>
          <Icon name="download" small />
          导入主题…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSaveAs}>
          <Icon name="plus" small />
          另存为自定义主题…
        </DropdownMenuItem>
        {modified ? (
          <DropdownMenuItem onSelect={onRestore}>
            <Icon name="undo" small />
            还原为 {current.name}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
