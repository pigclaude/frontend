// 负责「磨砂透明度」：glass.css 半透明表面的 alpha 基准表、随 g 变化的曲线，以及按色调输出变量。
import type { Hex } from "./color-math"
import { hexToRgb, mixHex } from "./color-math"

/** glass.css 中一个半透明表面：变量名、色调来源、在 g=60 时的 alpha。 */
export type GlassBase = {
  name: string
  /** ground 跟随底色；raised 是抬起的表面；popover 是弹层（有 alpha 下限）。 */
  role: "ground" | "raised" | "popover"
  /** pigclaude 未改 bg 时使用的颜色，近似 glass.css 里的 oklch 值。 */
  color: Hex
  alpha: number
}

/**
 * 抄自 styles/glass.css 的 [data-glass="true"] 与 [data-glass="true"][data-theme="dark"]。
 * 改 glass.css 时同步改这里。细线、输入底和头像底（--border/--divider/--field/--avatar）
 * 不是表面，不在此表，由叠色组处理。
 */
export const glassBases: Record<"light" | "dark", readonly GlassBase[]> = {
  light: [
    { name: "--glass-tint", role: "ground", color: "#FFFFFF", alpha: 0.16 },
    { name: "--bg", role: "ground", color: "#FFFFFF", alpha: 0.3 },
    { name: "--surface", role: "raised", color: "#FFFFFF", alpha: 0.62 },
    { name: "--panel", role: "raised", color: "#FFFFFF", alpha: 0.4 },
    { name: "--popover", role: "popover", color: "#FCFCFC", alpha: 0.78 },
    { name: "--popover-glass", role: "popover", color: "#FCFCFC", alpha: 0.68 },
  ],
  dark: [
    { name: "--glass-tint", role: "ground", color: "#000000", alpha: 0.42 },
    { name: "--bg", role: "ground", color: "#000000", alpha: 0.14 },
    { name: "--surface", role: "raised", color: "#FFFFFF", alpha: 0.07 },
    { name: "--panel", role: "raised", color: "#FFFFFF", alpha: 0.045 },
    { name: "--popover", role: "popover", color: "#1F1F20", alpha: 0.82 },
    { name: "--popover-glass", role: "popover", color: "#1F1F20", alpha: 0.72 },
  ],
}

/** g 的默认值：在这里得到 glass.css 原值。 */
export const defaultGlass = 60

/** 弹层在任何 g 下的最低 alpha，保证文字可读。 */
export const popoverFloor = 0.6

/**
 * 分段线性的 alpha 曲线：经过 (0, 1)、(60, base)、(100, base × 0.35)，对 g 单调不增，
 * 结果不低于 floor（g=0 时仍为 1）。各表面在 g=60 时的先后顺序在任何 g 下保持不变。
 */
export function alphaAt(base: number, g: number, floor = 0): number {
  const t = Math.min(100, Math.max(0, g))
  const raw =
    t <= defaultGlass
      ? Math.min(1, base + (1 - base) * ((defaultGlass - t) / defaultGlass))
      : base * (1 - (0.65 * (t - defaultGlass)) / (100 - defaultGlass))
  return Math.max(floor, raw)
}

/** 输出 `rgb(r g b / a)`，alpha 保留三位小数。 */
export function withAlpha(hex: Hex, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgb(${r} ${g} ${b} / ${Number(alpha.toFixed(3))})`
}

/** 改了 bg 后各表面的色调：底层用 bg，抬起的表面和弹层按浅深色从 bg 推出。 */
export type GlassTint = { ground: Hex; raised: Hex; popover: Hex }

/**
 * 按 g 输出磨砂表面变量。tint 为 null 时沿用 glass.css 的白/黑色调。
 * alpha 高于原值时把颜色向底层色调靠拢，使不透明后的观感接近原来叠在底层上的样子
 * （深色下 g=0 的 --surface 是深灰而不是纯白）。
 */
export function deriveGlassVars(
  tone: "light" | "dark",
  tint: GlassTint | null,
  g: number,
): Record<string, string> {
  const vars: Record<string, string> = {}
  const groundColor = tint?.ground ?? glassBases[tone][0].color
  for (const item of glassBases[tone]) {
    const color = tint ? tint[item.role] : item.color
    const alpha = alphaAt(item.alpha, g, item.role === "popover" ? popoverFloor : 0)
    const shown = alpha > item.alpha ? mixHex(groundColor, color, item.alpha / alpha) : color
    vars[item.name] = withAlpha(shown, alpha)
  }
  return vars
}
