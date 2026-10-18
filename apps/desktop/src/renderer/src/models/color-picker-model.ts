// 负责颜色选择器的纯运算：指针位置与 HSV 的换算、键盘步进、外部颜色同步、HEX 输入解析和对比度说明。
import { type Hex, hexToHsv, hsvToHex, parseHex } from "./color-math"

/** 选择器内部持有的颜色：h 为 0–360，s、v 为 0–1。 */
export type Hsv = { h: number; s: number; v: number }

/** 拖动区域在视口中的位置和尺寸，取自 getBoundingClientRect。 */
export type Area = { left: number; top: number; width: number; height: number }

/** 强调色选择器底部的 8 个常用色。 */
export const accentSwatches: readonly Hex[] = [
  "#1F8A55",
  "#339CFF",
  "#5E6AD2",
  "#BD93F9",
  "#E5484D",
  "#D97757",
  "#F5A524",
  "#18181B",
]

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))
const fraction = (offset: number, size: number): number => (size > 0 ? clamp01(offset / size) : 0)

/** 把 HEX 换成 HSV 对象。 */
export function hsvFromHex(hex: Hex): Hsv {
  const [h, s, v] = hexToHsv(hex)
  return { h, s, v }
}

/** 把 HSV 对象换成大写 HEX。 */
export function hsvHex(hsv: Hsv): Hex {
  return hsvToHex(hsv.h, hsv.s, hsv.v)
}

/** 方块内的指针位置换成饱和度（左 0 右 1）和亮度（上 1 下 0），越界时贴边。 */
export function svFromPoint(x: number, y: number, area: Area): { s: number; v: number } {
  return { s: fraction(x - area.left, area.width), v: 1 - fraction(y - area.top, area.height) }
}

/** 色相条上的指针横坐标换成 0–360 的色相，越界时贴边。 */
export function hueFromPoint(x: number, area: Area): number {
  return fraction(x - area.left, area.width) * 360
}

/** 方块的方向键：左右改饱和度，上下改亮度，每次 1%（Shift 时 10%）；不是方向键时返回 null。 */
export function stepSv(hsv: Hsv, key: string, shift: boolean): Hsv | null {
  const step = shift ? 0.1 : 0.01
  if (key === "ArrowLeft") return { ...hsv, s: clamp01(hsv.s - step) }
  if (key === "ArrowRight") return { ...hsv, s: clamp01(hsv.s + step) }
  if (key === "ArrowUp") return { ...hsv, v: clamp01(hsv.v + step) }
  if (key === "ArrowDown") return { ...hsv, v: clamp01(hsv.v - step) }
  return null
}

/** 色相条的按键：方向键每次 1%（3.6°，Shift 时 10%），Home/End 到两端；其他按键返回 null。 */
export function stepHue(hue: number, key: string, shift: boolean): number | null {
  const step = (shift ? 0.1 : 0.01) * 360
  if (key === "Home") return 0
  if (key === "End") return 360
  if (key === "ArrowLeft" || key === "ArrowDown") return Math.max(0, hue - step)
  if (key === "ArrowRight" || key === "ArrowUp") return Math.min(360, hue + step)
  return null
}

/**
 * 让内部 HSV 跟上外部颜色。颜色就是当前 HSV 得出的那个时原样返回；
 * 否则按新颜色计算，但灰色保留原色相、黑色保留原色相和饱和度，拖进黑色再拖回来不会跳色。
 */
export function syncHsv(prev: Hsv, hex: Hex): Hsv {
  if (hsvHex(prev) === hex) return prev
  const next = hsvFromHex(hex)
  if (next.v === 0) return { h: prev.h, s: prev.s, v: 0 }
  if (next.s === 0) return { ...next, h: prev.h }
  return next
}

/** 解析用户在 HEX 框里输入的文字：允许省略 #、首尾空白和小写，合法时返回大写 HEX，否则返回 null。 */
export function parseHexInput(text: string): Hex | null {
  const trimmed = text.trim()
  return parseHex(trimmed.startsWith("#") ? trimmed : `#${trimmed}`)
}

/** 底部说明「{label} · 对比度 x.x」；低于 min 时追加「· 偏低」。数值只舍不入，不会把不合格显示成合格。 */
export function contrastNote(
  label: string,
  ratio: number,
  min: number,
): { text: string; low: boolean } {
  const shown = (Math.floor(ratio * 10 + 1e-9) / 10).toFixed(1)
  const low = ratio < min
  return { text: `${label} · 对比度 ${shown}${low ? " · 偏低" : ""}`, low }
}
