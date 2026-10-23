// 负责六种固定卡面的键盘单选，不改变主题色。
import "./card-style-picker.css"
import type { CardStyle } from "@pigclaude/api/membership/types"
import { MembershipCard, MembershipCardGroup } from "@pigclaude/web-ui/components/membership-card"
const names: Record<CardStyle, string> = {
  azure: "蓝",
  gold: "金",
  obsidian: "黑曜",
  violet: "紫",
  emerald: "翠绿",
  rose: "玫瑰",
}
/** 提供固定卡面缩略图和单一键盘入口，缩略图上写中文卡面名。 */
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
      <div className="card-style-picker grid w-full grid-cols-2 gap-2 sm:grid-cols-3">
        {(Object.keys(names) as CardStyle[]).map((style) => (
          <MembershipCard
            key={style}
            name={names[style]}
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
