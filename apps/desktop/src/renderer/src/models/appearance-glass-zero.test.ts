// 校验磨砂 g=0 时与不透明配色一致：pigclaude 等于 tokens.css 原值，改过的主题等于非磨砂推导，表面层次不塌。
import { describe, expect, it } from "vitest"
import type { Hex } from "./color-math"
import { contrastRatio } from "./color-math"
import type { AppearanceSettings } from "./appearance-settings"
import { defaultAppearance } from "./appearance-settings"
import type { AppearanceEnvironment } from "./appearance-tokens"
import { deriveAppearance } from "./appearance-tokens"

type Tone = "light" | "dark"

const env = (resolved: Tone, glass: boolean): AppearanceEnvironment => ({
  resolved,
  glass,
  platform: "darwin",
  prefersReducedMotion: false,
})

const withSettings = (patch: Partial<AppearanceSettings>): AppearanceSettings => ({
  ...defaultAppearance,
  ...patch,
})

// 磨砂下会被改写、g=0 时必须回到不透明配色的变量；--glass-tint 对应不透明时的 --window
const opaqueNames = [
  "--bg",
  "--surface",
  "--panel",
  "--popover",
  "--popover-glass",
  "--sidebar",
  "--avatar",
  "--border",
  "--divider",
  "--field",
] as const

describe("g=0：pigclaude 未改颜色", () => {
  for (const tone of ["light", "dark"] as const) {
    it(`${tone}：每个变量等于默认主题原值，--glass-tint 等于 --window`, () => {
      const vars = deriveAppearance(withSettings({ glass: 0 }), [], env(tone, true)).vars
      expect(vars).toEqual({})
    })

    it(`${tone}：--surface、--panel 与 --bg 可区分`, () => {
      const vars = deriveAppearance(withSettings({ glass: 0 }), [], env(tone, true)).vars
      expect(vars).toEqual({})
    })
  }
})

describe("g=0：改过颜色的主题（Claude）", () => {
  const claude = (glass: number): AppearanceSettings =>
    withSettings({ light: { ...defaultAppearance.light, themeId: "claude" }, glass })

  for (const tone of ["light", "dark"] as const) {
    it(`${tone}：等于同一主题的非磨砂推导`, () => {
      const glassy = deriveAppearance(claude(0), [], env(tone, true)).vars
      const opaque = deriveAppearance(claude(0), [], env(tone, false)).vars
      for (const name of opaqueNames) expect(glassy[name], name).toBe(opaque[name])
      expect(glassy["--glass-tint"]).toBe(opaque["--window"])
    })

    it(`${tone}：--surface 与 --bg 有可见差别`, () => {
      const vars = deriveAppearance(claude(0), [], env(tone, true)).vars
      const surface = vars["--surface"] as Hex
      const bg = vars["--bg"] as Hex
      expect(contrastRatio(surface, bg)).toBeGreaterThan(1.02)
    })
  }

  it("g=60 时仍是 glass.css 的 alpha，g=30 介于两者之间", () => {
    const at = (g: number) => deriveAppearance(claude(g), [], env("light", true)).vars
    expect(at(60)["--surface"]).toMatch(/\/ 0\.62\)$/)
    expect(at(60)["--sidebar"]).toBeUndefined()
    const mid = Number(/\/ ([\d.]+)\)$/.exec(at(30)["--bg"] ?? "")?.[1])
    expect(mid).toBeGreaterThan(0.3)
    expect(mid).toBeLessThan(1)
  })
})
