// 负责「Dock 图标」的三张图标卡片单选；卡片里是 renderDockIcon 画出的缩略图。
import { useEffect, useState } from "react"
import { RadioGroup, RadioGroupCard } from "../../../components/ui/radio-group"
import { renderDockIcon } from "../../../lib/dock-icon-image"
import type { AppearanceSettings } from "@pigclaude/ui-primitives"
import { useText } from "../../../locale/text"

type DockIcon = AppearanceSettings["dockIcon"]

const icons: DockIcon[] = ["classic", "pink", "night"]

/** 渲染 Dock 图标单选；缩略图画好之前卡片先空着。 */
export function DockIconPicker({
  value,
  onChange,
}: {
  value: DockIcon
  onChange: (value: DockIcon) => void
}) {
  const { t } = useText()
  const [images, setImages] = useState<Partial<Record<DockIcon, string>>>({})
  useEffect(() => {
    let cancelled = false
    for (const icon of icons) {
      void renderDockIcon(icon)
        .then((url) => {
          if (!cancelled) setImages((current) => ({ ...current, [icon]: url }))
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
      aria-label={t("appearance.dock.title")}
      value={value}
      onValueChange={(next) => {
        const icon = icons.find((item) => item === next)
        if (icon && icon !== value) onChange(icon)
      }}
    >
      {icons.map((icon) => (
        <RadioGroupCard
          key={icon}
          value={icon}
          className="dock-card"
          aria-label={t(`appearance.dock.${icon}`)}
          title={t(`appearance.dock.${icon}`)}
        >
          {images[icon] ? <img src={images[icon]} alt="" draggable={false} /> : null}
        </RadioGroupCard>
      ))}
    </RadioGroup>
  )
}
