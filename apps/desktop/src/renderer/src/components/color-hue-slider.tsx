// 负责颜色选择器里的色相条：彩虹渐变上拖动圆形拖柄，或用方向键改色相。
import type { KeyboardEvent } from "react"
import { hsvToHex } from "../models/color-math"
import { hueFromPoint, stepHue } from "../models/color-picker-model"
import { pointerDragHandlers } from "../lib/pointer-drag"

/** 渲染色相条。可聚焦，读屏器读作 0–360° 的滑块；每次拖动或按键都用新色相调用 onChange。 */
export function ColorHueSlider({
  label,
  hue,
  onChange,
}: {
  label: string
  hue: number
  onChange: (hue: number) => void
}) {
  const drag = pointerDragHandlers((x, _y, area) => onChange(hueFromPoint(x, area)))
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = stepHue(hue, event.key, event.shiftKey)
    if (next === null) return
    event.preventDefault()
    onChange(next)
  }
  return (
    <div
      className="cp-hue"
      role="slider"
      tabIndex={0}
      aria-label={`${label}的色相`}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(hue)}
      aria-valuetext={`色相 ${Math.round(hue)}°`}
      onKeyDown={onKeyDown}
      {...drag}
    >
      <span
        className="cp-knob"
        style={{ left: `${(hue / 360) * 100}%`, backgroundColor: hsvToHex(hue, 1, 1) }}
      />
    </div>
  )
}
