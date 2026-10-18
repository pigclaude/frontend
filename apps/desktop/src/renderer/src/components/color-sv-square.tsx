// 负责颜色选择器里的饱和度/亮度方块：拖动或用方向键改 s、v，色相保持不变。
import type { KeyboardEvent } from "react"
import { hsvToHex } from "../models/color-math"
import { type Hsv, hsvHex, stepSv, svFromPoint } from "../models/color-picker-model"
import { pointerDragHandlers } from "../lib/pointer-drag"

const percent = (value: number): number => Math.round(value * 100)

/** 渲染饱和度/亮度方块。可聚焦，读屏器读作滑块；每次拖动或按键都用新的 HSV 调用 onChange。 */
export function ColorSvSquare({
  label,
  hsv,
  onChange,
}: {
  label: string
  hsv: Hsv
  onChange: (next: Hsv) => void
}) {
  const drag = pointerDragHandlers((x, y, area) =>
    onChange({ h: hsv.h, ...svFromPoint(x, y, area) }),
  )
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = stepSv(hsv, event.key, event.shiftKey)
    if (!next) return
    event.preventDefault()
    onChange(next)
  }
  return (
    <div
      className="cp-sv"
      role="slider"
      tabIndex={0}
      aria-label={`${label}的饱和度与亮度`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent(hsv.s)}
      aria-valuetext={`饱和度 ${percent(hsv.s)}%，亮度 ${percent(hsv.v)}%`}
      style={{ backgroundColor: hsvToHex(hsv.h, 1, 1) }}
      onKeyDown={onKeyDown}
      {...drag}
    >
      <span
        className="cp-knob"
        style={{
          left: `${hsv.s * 100}%`,
          top: `${(1 - hsv.v) * 100}%`,
          backgroundColor: hsvHex(hsv),
        }}
      />
    </div>
  )
}
