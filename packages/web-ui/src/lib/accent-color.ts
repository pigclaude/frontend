// 负责公开主题色的 OKLCH 转换、sRGB 色域压缩和 WCAG 对比度计算。
import { accentEngine } from "./accent-engine"

/** 主题强调文字必须对齐的深浅背景。 */
export const ACCENT_BG = { dark: "#08090a", light: "#f7f8f8" } as const
/** 将六位 HEX 转为 OKLCH。 */
export const hexToOklch = accentEngine.hexToOklch
/** 将 OKLCH 转为六位 HEX，超出 sRGB 时逐步降低色度。 */
export const oklchToHex = accentEngine.oklchToHex
/** 按 WCAG 2.x 相对亮度计算两种 HEX 的对比度。 */
export const contrastRatio = accentEngine.contrastRatio
