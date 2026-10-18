// 负责外观页「模式」的三张缩略卡片：跟随系统（左浅右深）、浅色、深色。
import { RadioGroup, RadioGroupCard } from "../../../components/ui/radio-group"
import type { ThemePreference } from "../../../models/theme-model"
import type { ShownColors } from "../../../models/theme-editing"

function Half({ colors }: { colors: ShownColors }) {
  return (
    <span className="mode-half" style={{ backgroundColor: colors.bg }}>
      <i style={{ backgroundColor: colors.fg, opacity: 0.55, width: "70%" }} />
      <i style={{ backgroundColor: colors.fg, opacity: 0.25 }} />
      <i style={{ backgroundColor: colors.accent, width: "55%" }} />
    </span>
  )
}

/** 渲染模式单选。缩略图用两种模式当前主题（含修改）的背景、前景和强调色画。 */
export function ModePicker({
  value,
  light,
  dark,
  onChange,
}: {
  value: ThemePreference
  light: ShownColors
  dark: ShownColors
  onChange: (mode: ThemePreference) => void
}) {
  const cards: { mode: ThemePreference; label: string; halves: ShownColors[] }[] = [
    { mode: "system", label: "跟随系统", halves: [light, dark] },
    { mode: "light", label: "浅色", halves: [light] },
    { mode: "dark", label: "深色", halves: [dark] },
  ]
  return (
    <RadioGroup
      className="mode-cards"
      orientation="horizontal"
      aria-label="模式"
      value={value}
      onValueChange={(next) => {
        const card = cards.find((item) => item.mode === next)
        if (card && card.mode !== value) onChange(card.mode)
      }}
    >
      {cards.map((card) => (
        <RadioGroupCard key={card.mode} value={card.mode} className="mode-card">
          <span className="mode-thumb">
            {card.halves.map((colors, index) => (
              <Half key={index} colors={colors} />
            ))}
          </span>
          <span className="mode-label">{card.label}</span>
        </RadioGroupCard>
      ))}
    </RadioGroup>
  )
}
