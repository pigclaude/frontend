// 负责「Dock 图标」的三张图标卡片单选；卡片里是 renderDockIcon 画出的缩略图。
import { useEffect, useState } from "react"
import { RadioGroup, RadioGroupCard } from "../../../components/ui/radio-group"
import { renderDockIcon } from "../../../lib/dock-icon-image"
import type { AppearanceSettings } from "../../../models/appearance-settings"

type DockIcon = AppearanceSettings["dockIcon"]

const icons: { value: DockIcon; label: string }[] = [
  { value: "classic", label: "经典" },
  { value: "pink", label: "粉色" },
  { value: "night", label: "夜色" },
]

/** 渲染 Dock 图标单选；缩略图画好之前卡片先空着。 */
export function DockIconPicker({
  value,
  onChange,
}: {
  value: DockIcon
  onChange: (value: DockIcon) => void
}) {
  const [images, setImages] = useState<Partial<Record<DockIcon, string>>>({})
  useEffect(() => {
    let cancelled = false
    for (const icon of icons) {
      void renderDockIcon(icon.value)
        .then((url) => {
          if (!cancelled) setImages((current) => ({ ...current, [icon.value]: url }))
        })
        .catch(() => undefined)
    }
    return () => {
      cancelled = true
    }
  }, [])
  return (
    <RadioGroup
      className="dock-cards"
      orientation="horizontal"
      aria-label="Dock 图标"
      value={value}
      onValueChange={(next) => {
        const icon = icons.find((item) => item.value === next)
        if (icon && icon.value !== value) onChange(icon.value)
      }}
    >
      {icons.map((icon) => (
        <RadioGroupCard
          key={icon.value}
          value={icon.value}
          className="dock-card"
          aria-label={icon.label}
          title={icon.label}
        >
          {images[icon.value] ? <img src={images[icon.value]} alt="" draggable={false} /> : null}
        </RadioGroupCard>
      ))}
    </RadioGroup>
  )
}
