// 负责提供可同时用于运行时和无注释首帧脚本的自包含色彩与缓存校验引擎。
import type { AccentPalette, AccentPreset } from "./accent-presets"
import type { AccentChoice } from "./accent"

type Color = { l: number; c: number; h: number }

/** 构造无外部运行时依赖的引擎，确保首帧和 React 使用完全相同的算法。 */
export function createAccentEngine() {
  const backgrounds = { dark: "#08090a", light: "#f7f8f8" }
  const white = "#ffffff"
  const nearBlack = "#191a1b"
  const validHex = (value: unknown): value is string =>
    typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
  function linear(hex: string) {
    if (!validHex(hex)) throw new Error("Invalid HEX")
    return [1, 3, 5].map((offset) => {
      const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
  }
  function contrastRatio(a: string, b: string) {
    const luminance = (hex: string) => {
      const [r, g, b] = linear(hex)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const x = luminance(a)
    const y = luminance(b)
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  }
  function hexToOklch(hex: string): Color {
    const [r, g, b] = linear(hex)
    const x = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const y = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const z = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    const l = 0.2104542553 * x + 0.793617785 * y - 0.0040720468 * z
    const a = 1.9779984951 * x - 2.428592205 * y + 0.4505937099 * z
    const bb = 0.0259040371 * x + 0.7827717662 * y - 0.808675766 * z
    return { l, c: Math.hypot(a, bb), h: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 }
  }
  function oklchToHex(color: Color) {
    const l = Math.max(0, Math.min(1, color.l))
    const hue = (color.h * Math.PI) / 180
    let c = Math.max(0, color.c)
    let rgb: number[] = []
    for (let step = 0; step <= 400; step++) {
      const a = c * Math.cos(hue)
      const b = c * Math.sin(hue)
      const x = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
      const y = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
      const z = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
      rgb = [
        4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z,
        -1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z,
        -0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z,
      ]
      if (rgb.every((v) => v >= -0.000001 && v <= 1.000001)) break
      c = step === 399 ? 0 : c * 0.96
    }
    return (
      "#" +
      rgb
        .map((v) => {
          const channel = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
          return Math.round(Math.max(0, Math.min(1, channel)) * 255)
            .toString(16)
            .padStart(2, "0")
        })
        .join("")
    )
  }
  function deriveAccent(hex: string): AccentPalette {
    const brand = hexToOklch(hex)
    const fill = { ...brand }
    for (let i = 0; i < 100 && contrastRatio(white, oklchToHex(fill)) < 4.5; i++)
      fill.l = Math.max(0, fill.l - 0.01)
    const active = oklchToHex({ ...fill, l: Math.max(0.15, fill.l - 0.08) })
    const darkInk = { ...brand }
    for (let i = 0; i < 100 && contrastRatio(oklchToHex(darkInk), backgrounds.dark) < 4.5; i++)
      darkInk.l = Math.min(0.95, darkInk.l + 0.01)
    const lightInk = { ...fill }
    for (let i = 0; i < 100 && contrastRatio(oklchToHex(lightInk), backgrounds.light) < 4.5; i++)
      lightInk.l = Math.max(0, lightInk.l - 0.01)
    const accent = oklchToHex(fill)
    const accentOn =
      contrastRatio(white, accent) >= contrastRatio(nearBlack, accent) ? white : nearBlack
    const glow = hex.toLowerCase()
    return {
      dark: {
        accent,
        accentOn,
        accentHover: oklchToHex(darkInk),
        accentActive: active,
        accentGlow: glow,
        accentInk: oklchToHex(darkInk),
        landingInkFrom: oklchToHex({ ...brand, l: Math.min(0.92, brand.l + 0.18) }),
        landingInkTo: oklchToHex(darkInk),
      },
      light: {
        accent,
        accentOn,
        accentHover: accent,
        accentActive: active,
        accentGlow: glow,
        accentInk: oklchToHex(lightInk),
        landingInkFrom: glow,
        landingInkTo: oklchToHex(lightInk),
      },
    }
  }
  function paletteFor(choice: AccentChoice, presets: readonly AccentPreset[]) {
    if (choice.kind === "custom") return deriveAccent(choice.hex)
    return presets.find((preset) => preset.id === choice.id) ?? presets[0]
  }
  function accentCss(palette: AccentPalette) {
    const names = {
      accent: "accent",
      accentOn: "accent-on",
      accentHover: "accent-hover",
      accentActive: "accent-active",
      accentGlow: "accent-glow",
      accentInk: "accent-ink",
      landingInkFrom: "landing-ink-from",
      landingInkTo: "landing-ink-to",
    } as const
    return (["dark", "light"] as const)
      .map((mode) => {
        const tokens = palette[mode]
        const declarations = (Object.keys(names) as (keyof typeof names)[])
          .map((key) => `--${names[key]}:${tokens[key]};`)
          .join("")
        const hover =
          contrastRatio(tokens.accentOn, tokens.accentHover) >= 4.5
            ? tokens.accentHover
            : tokens.accent
        const active =
          contrastRatio(tokens.accentOn, tokens.accentActive) >= 4.5
            ? tokens.accentActive
            : tokens.accent
        return `html:root${mode === "light" ? '[data-theme="light"]' : ""}{${declarations}--btn-primary-hover:${hover};--btn-primary-active:${active};}`
      })
      .join("")
  }
  function parse(
    raw: string | null,
    presets: readonly AccentPreset[],
  ): { choice: AccentChoice; css: string } | null {
    try {
      const value = JSON.parse(raw ?? "null")
      if (!value || value.v !== 1 || typeof value.css !== "string" || !value.choice) return null
      const choice = value.choice
      if (choice.kind === "preset") {
        if (!presets.some((preset) => preset.id === choice.id)) return null
      } else if (choice.kind !== "custom" || !validHex(choice.hex)) return null
      const normalized: AccentChoice =
        choice.kind === "preset"
          ? { kind: "preset", id: choice.id }
          : { kind: "custom", hex: choice.hex.toLowerCase() }
      const css = accentCss(paletteFor(normalized, presets))
      return value.css === css ? { choice: normalized, css } : null
    } catch {
      return null
    }
  }
  return { hexToOklch, oklchToHex, contrastRatio, deriveAccent, paletteFor, accentCss, parse }
}

/** 共享运行时色彩引擎，首帧序列化使用相同工厂。 */
export const accentEngine = createAccentEngine()
