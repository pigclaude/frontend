// 负责六种固定卡面的键盘单选，不改变主题色。
import type { CardStyle } from "@pigclaude/api/membership/types"
import { MembershipCard, MembershipCardGroup } from "@pigclaude/web-ui/components/membership-card"
/** 提供固定卡面缩略图和单一键盘入口。 */
export function CardStylePicker({
  value,
  disabled,
  onChange,
}: {
  value: CardStyle
  disabled: boolean
  onChange: (value: CardStyle) => void
}) {
  return (
    <MembershipCardGroup label="卡面">
      <div className="grid grid-cols-3 gap-2">
        {(["azure", "gold", "obsidian", "violet", "emerald", "rose"] as const).map((style) => (
          <MembershipCard
            key={style}
            name={style}
            cardStyle={style}
            size="sm"
            selected={value === style}
            disabled={disabled}
            onSelect={() => onChange(style)}
          />
        ))}
      </div>
    </MembershipCardGroup>
  )
}
