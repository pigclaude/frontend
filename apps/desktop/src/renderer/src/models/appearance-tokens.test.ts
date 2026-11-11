// 校验外观设置到 CSS 变量的推导：默认不输出、按组归属、磨砂曲线、对比度、字号和 data-* 开关。
import { describe, expect, it } from "vitest"
import { readableOn } from "./color-math"
import type { AppearanceSettings } from "./appearance-settings"
import { defaultAppearance, setOverride } from "./appearance-settings"
import { glassBases } from "./appearance-glass"
import type { AppearanceEnvironment } from "./appearance-tokens"
import type { ThemeDefinition } from "./theme-presets"
import { accentVars, deriveAppearance, overlayVars, surfaceVars } from "./appearance-tokens"

const env = (
  resolved: "light" | "dark",
  glass = false,
  prefersReducedMotion = false,
): AppearanceEnvironment => ({ resolved, glass, platform: "darwin", prefersReducedMotion })

const withSettings = (patch: Partial<AppearanceSettings>): AppearanceSettings => ({
  ...defaultAppearance,
  ...patch,
})

/** 取出 `… / a)` 形式的 alpha；没有 alpha 的颜色视为 1。 */
function alphaOf(value: string | undefined): number {
  if (value === undefined) throw new Error("变量未输出")
  const match = /\/\s*([\d.]+)\)$/.exec(value)
  return match ? Number(match[1]) : 1
}

describe("默认设置", () => {
  for (const resolved of ["light", "dark"] as const) {
    for (const glass of [true, false]) {
      it(`${resolved} · glass=${glass} 时不输出任何变量和属性`, () => {
        expect(deriveAppearance(defaultAppearance, [], env(resolved, glass))).toEqual({
          vars: {},
          attrs: {},
        })
      })
    }
  }

  it("不修改传入的默认设置", () => {
    const before = JSON.stringify(defaultAppearance)
    deriveAppearance(withSettings({ sidebarTranslucency: 0, contrast: 100 }), [], env("dark", true))
    expect(JSON.stringify(defaultAppearance)).toBe(before)
  })
})

describe("磨砂", () => {
  const at = (g: number, tone: "light" | "dark") =>
    deriveAppearance(withSettings({ sidebarTranslucency: g }), [], env(tone, true)).vars

  for (const tone of ["light", "dark"] as const) {
    it(`${tone}：g=0 时底层与抬起的表面不透明`, () => {
      const vars = at(0, tone)
      expect(vars).toEqual({})
    })

    it(`${tone}：g 从 0 到 100 每个面对桌面的磨砂变量 alpha 单调不增`, () => {
      // --panel 是叠在 bg/surface 上的层，不直接面对桌面：g=0 时是 tokens.css 的淡叠色，不在此列
      for (const { name, alpha } of glassBases[tone].filter((item) => item.name !== "--panel")) {
        let last = Infinity
        for (let g = 10; g <= 100; g += 10) {
          const value = at(g, tone)[name]
          // g=60 时不输出，页面沿用 glass.css 原值
          const a = value === undefined && g === 60 ? alpha : alphaOf(value)
          expect(a).toBeLessThanOrEqual(last)
          last = a
        }
      }
    })

    it(`${tone}：g=100 时 --popover 与 --popover-glass alpha 不低于 0.6`, () => {
      const vars = at(100, tone)
      expect(alphaOf(vars["--popover"])).toBeGreaterThanOrEqual(0.6)
      expect(alphaOf(vars["--popover-glass"])).toBeGreaterThanOrEqual(0.6)
    })
  }

  it("light：任意 g 下 --surface alpha ≥ --bg alpha", () => {
    for (let g = 10; g <= 100; g += 10) {
      if (g === 60) continue
      const vars = at(g, "light")
      expect(alphaOf(vars["--surface"])).toBeGreaterThanOrEqual(alphaOf(vars["--bg"]))
    }
  })

  it("dark：任意 g 下 --surface 叠在 --bg 上的合成不透明度 ≥ --bg alpha", () => {
    for (let g = 10; g <= 100; g += 10) {
      if (g === 60) continue
      const vars = at(g, "dark")
      const bg = alphaOf(vars["--bg"])
      const stacked = 1 - (1 - bg) * (1 - alphaOf(vars["--surface"]))
      expect(stacked).toBeGreaterThanOrEqual(bg)
    }
  })

  it("g=60 且 bg 未改时不输出；非磨砂环境下改 g 也不输出", () => {
    expect(at(60, "light")).toEqual({})
    expect(
      deriveAppearance(withSettings({ sidebarTranslucency: 0 }), [], env("light", false)).vars,
    ).toEqual({})
  })

  it("pigclaude 未改 bg 时保持白色调；改了 bg 用 bg 的 RGB", () => {
    expect(at(100, "light")["--bg"]).toBe("rgb(255 255 255 / 0.105)")
    const tinted = setOverride(withSettings({ sidebarTranslucency: 60 }), "light", "bg", "#FAF0E6")
    const vars = deriveAppearance(tinted, [], env("light", true)).vars
    expect(vars["--bg"]).toBe("rgb(250 240 230 / 0.3)")
    expect(vars["--window"]).toBeUndefined()
  })
})

describe("修改归属", () => {
  it("splitModes=false 时在浅色改 bg，深色下不输出表面组", () => {
    const settings = setOverride(defaultAppearance, "light", "bg", "#FFFFFF")
    const dark = deriveAppearance(settings, [], env("dark"))
    for (const name of surfaceVars) expect(dark.vars[name]).toBeUndefined()
    expect(dark).toEqual({ vars: {}, attrs: {} })
    const light = deriveAppearance(settings, [], env("light"))
    expect(light.vars["--bg"]).toBe("#FFFFFF")
  })

  it("pigclaude 只改 accent 时只出现强调组变量", () => {
    const base = withSettings({ light: { ...defaultAppearance.light, accentMode: "custom" } })
    const settings = setOverride(base, "light", "accent", "#FF0066")
    for (const glass of [true, false]) {
      const out = deriveAppearance(settings, [], env("light", glass))
      expect(Object.keys(out.vars).sort()).toEqual([...accentVars].sort())
      expect(out.vars["--primary"]).toBe("#FF0066")
      expect(out.vars["--accent-ring"]).toBe("rgb(255 0 102 / 0.22)")
      expect(out.attrs).toEqual({ "data-accent": "custom" })
    }
  })

  it("pigclaude 默认强调色下即使存了 accent 修改也不输出强调组", () => {
    const settings = setOverride(defaultAppearance, "light", "accent", "#FF0066")
    expect(deriveAppearance(settings, [], env("light")).vars).toEqual({})
  })

  it("pigclaude 只改 fg 时只出现文字组", () => {
    const settings = setOverride(defaultAppearance, "dark", "fg", "#FFFFFF")
    const out = deriveAppearance(settings, [], env("dark"))
    expect(Object.keys(out.vars).sort()).toEqual(["--faint", "--fg", "--fg-2", "--muted"])
    expect(out.vars["--fg"]).toBe("#FFFFFF")
  })
})

describe("内置主题", () => {
  it("ChatGPT 默认强调色：--switch-on 为 #339CFF，--on-primary 按亮度取黑白", () => {
    const settings = withSettings({ light: { ...defaultAppearance.light, themeId: "chatgpt" } })
    const out = deriveAppearance(settings, [], env("dark"))
    expect(out.vars["--switch-on"]).toBe("#339CFF")
    expect(out.vars["--on-primary"]).toBe(readableOn("#339CFF"))
    expect(out.vars["--bg"]).toBe("#181818")
    expect(out.vars["--fg"]).toBe("#FFFFFF")
    expect(out.attrs).toEqual({ "data-accent": "theme" })
  })

  it("输出强调组时总写 data-accent，让滑块填充和焦点光晕也跟随主题强调色", () => {
    for (const accentMode of ["default", "custom"] as const) {
      const slot = { ...defaultAppearance.light, themeId: "nord", accentMode }
      const out = deriveAppearance(withSettings({ light: slot }), [], env("light"))
      expect(out.vars["--accent-ring"]).toBeDefined()
      expect(out.attrs["data-accent"]).toBe(accentMode === "custom" ? "custom" : "theme")
    }
  })

  it("pigclaude 默认强调色不输出强调组，也不写 data-accent", () => {
    for (const glass of [true, false]) {
      const out = deriveAppearance(defaultAppearance, [], env("dark", glass))
      expect(out.attrs["data-accent"]).toBeUndefined()
    }
  })

  it("深色背景用白色叠色，浅色背景用深色叠色", () => {
    const settings = withSettings({ light: { ...defaultAppearance.light, themeId: "nord" } })
    expect(deriveAppearance(settings, [], env("dark")).vars["--border"]).toBe(
      "oklch(100% 0 0 / 0.08)",
    )
    expect(deriveAppearance(settings, [], env("light")).vars["--border"]).toBe(
      "oklch(20% 0.01 270 / 0.08)",
    )
  })

  it("自定义主题优先于内置主题", () => {
    const custom: ThemeDefinition[] = [
      {
        id: "mine",
        name: "我的",
        builtIn: false,
        light: { bg: "#101010", fg: "#F0F0F0", accent: "#00AA55" },
        dark: { bg: "#101010", fg: "#F0F0F0" },
      },
    ]
    const settings = withSettings({ light: { ...defaultAppearance.light, themeId: "mine" } })
    expect(deriveAppearance(settings, custom, env("light")).vars["--link"]).toBe("#00AA55")
    expect(deriveAppearance(settings, custom, env("dark")).vars["--link"]).toBeUndefined()
  })
})

describe("对比度", () => {
  it("contrast=45 且 bg 未改时不输出叠色组", () => {
    const out = deriveAppearance(withSettings({ contrast: 45 }), [], env("light"))
    for (const name of overlayVars) expect(out.vars[name]).toBeUndefined()
  })

  it("contrast=100 时 --border alpha 大于原值，contrast=0 时不低于原值的 0.4", () => {
    for (const tone of ["light", "dark"] as const) {
      const high = deriveAppearance(withSettings({ contrast: 100 }), [], env(tone)).vars
      expect(alphaOf(high["--border"])).toBeGreaterThan(0.08)
      const low = deriveAppearance(withSettings({ contrast: 0 }), [], env(tone)).vars
      expect(alphaOf(low["--border"])).toBeGreaterThanOrEqual(0.08 * 0.4 - 1e-9)
      expect(alphaOf(low["--border"])).toBeLessThan(0.08)
    }
  })

  it("磨砂下对比度以 glass.css 的细线原值为基准", () => {
    const vars = deriveAppearance(withSettings({ contrast: 100 }), [], env("light", true)).vars
    expect(alphaOf(vars["--border"])).toBeGreaterThan(0.1)
    expect(vars["--bg"]).toBeUndefined()
  })
})

describe("字号与字体", () => {
  it("uiSize=15 时 --ui-scale 为 15/13", () => {
    const vars = deriveAppearance(withSettings({ uiSize: 15 }), [], env("light")).vars
    expect(vars).toEqual({ "--ui-scale": String(15 / 13) })
  })

  it("内容与代码字号直接取值", () => {
    const vars = deriveAppearance(
      withSettings({ contentSize: 15, codeSize: 13 }),
      [],
      env("light"),
    ).vars
    expect(vars).toEqual({ "--fs-content": "15px", "--fs-code": "13px" })
  })

  it("字体与字重映射到对应变量，中文回退链沿用现有顺序", () => {
    const vars = deriveAppearance(
      withSettings({
        light: { ...defaultAppearance.light, uiFont: "inter" },
        uiWeight: "medium",
        contentFont: "serif",
        codeFont: "jetbrains",
        codeWeight: "medium",
      }),
      [],
      env("light"),
    ).vars
    expect(vars["--font-ui"]).toMatch(
      /^"Inter", -apple-system, .*"PingFang SC", "Hiragino Sans GB"/,
    )
    expect(vars["--font-content"]).toMatch(/serif$/)
    expect(vars["--font-mono"]).toMatch(/^"JetBrains Mono", "SF Mono"/)
    expect(vars["--font-weight-ui"]).toBe("500")
    expect(vars["--font-weight-code"]).toBe("500")
    expect(vars["--font-weight-content"]).toBeUndefined()
  })
})

describe("data-* 属性", () => {
  it("diffMarker=sign 时 data-diff 为 sign", () => {
    const out = deriveAppearance(withSettings({ diffMarker: "sign" }), [], env("light"))
    expect(out.attrs["data-diff"]).toBe("sign")
  })

  it("减少动态效果：开启，或跟随系统且系统要求减少", () => {
    const on = deriveAppearance(withSettings({ motion: "on" }), [], env("light"))
    expect(on.attrs).toEqual({ "data-motion": "reduce" })
    const system = deriveAppearance(defaultAppearance, [], env("light", false, true))
    expect(system.attrs).toEqual({ "data-motion": "reduce" })
  })

  it("减少动态效果关闭时写 data-motion=full，压过系统的减少动态偏好", () => {
    for (const prefers of [true, false]) {
      const off = deriveAppearance(
        withSettings({ motion: "off" }),
        [],
        env("light", false, prefers),
      )
      expect(off.attrs).toEqual({ "data-motion": "full" })
    }
  })

  it("指针、字体平滑、全宽各自写入属性", () => {
    const out = deriveAppearance(
      withSettings({ pointerCursor: true, fontSmoothing: false, fullWidth: true }),
      [],
      env("light"),
    )
    expect(out.attrs).toEqual({
      "data-pointer": "true",
      "data-smoothing": "off",
      "data-fullwidth": "true",
    })
  })
})
