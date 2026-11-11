// 校验外观设置的解析、序列化、按主题保存的颜色修改和重置。
import { describe, expect, it } from "vitest"
import {
  activeSlot,
  defaultAppearance,
  parseAppearance,
  parseCustomThemes,
  resetAppearance,
  serializeAppearance,
  setOverride,
} from "./appearance-settings"

describe("parseAppearance", () => {
  it("没有任何数据时返回默认值", () => {
    expect(parseAppearance(null, null)).toEqual(defaultAppearance)
  })

  it("从旧的主题键迁移 mode", () => {
    expect(parseAppearance(null, "dark").mode).toBe("dark")
    expect(parseAppearance(null, "junk").mode).toBe("system")
  })

  it("坏 JSON、非对象或未知 version 返回默认值", () => {
    expect(parseAppearance("{bad", null)).toEqual(defaultAppearance)
    expect(parseAppearance("[1]", null)).toEqual(defaultAppearance)
    expect(parseAppearance('{"version":2,"glass":10}', null)).toEqual(defaultAppearance)
  })

  it("每个字段单独校验：非法用默认，数字夹到范围并取整", () => {
    const s = parseAppearance('{"version":1,"glass":"abc","uiSize":999,"contrast":70}', null)
    expect(s.glass).toBe(0)
    expect(s.uiSize).toBe(18)
    expect(s.contrast).toBe(70)
    const t = parseAppearance(
      '{"version":1,"uiSize":13.3,"glass":33.6,"codeSize":1,"motion":"x","mode":"dark"}',
      null,
    )
    expect(t.uiSize).toBe(13.5)
    expect(t.glass).toBe(34)
    expect(t.codeSize).toBe(10)
    expect(t.motion).toBe("system")
    expect(t.mode).toBe("dark")
  })

  it("解析主题槽并丢弃非法颜色修改与空对象", () => {
    const s = parseAppearance(
      JSON.stringify({
        version: 1,
        splitModes: true,
        light: { themeId: "nord", accentMode: "custom", uiFont: "inter" },
        dark: { themeId: 5, accentMode: "zzz" },
        overrides: {
          nord: { light: { bg: "#abcdef", fg: "red" }, dark: { bg: "bad" } },
          empty: {},
        },
      }),
      null,
    )
    expect(s.splitModes).toBe(true)
    expect(s.light).toEqual({ themeId: "nord", accentMode: "custom", uiFont: "inter" })
    expect(s.dark).toEqual(defaultAppearance.dark)
    expect(s.overrides).toEqual({ nord: { light: { bg: "#ABCDEF" } } })
  })

  it("序列化后能原样读回", () => {
    const changed = setOverride(defaultAppearance, "dark", "accent", "#112233")
    const next = { ...changed, glass: 20, fullWidth: true, dockIcon: "night" as const }
    expect(parseAppearance(serializeAppearance(next), null)).toEqual(next)
  })
})

describe("parseCustomThemes", () => {
  const theme = {
    id: "a",
    name: "A",
    light: { bg: "#FFFFFF", fg: "#000000", accent: "#FF0000" },
    dark: { bg: "#000000", fg: "#FFFFFF" },
  }

  it("读出合法主题并标记 builtIn=false", () => {
    const list = parseCustomThemes(JSON.stringify([theme]))
    expect(list).toEqual([{ ...theme, builtIn: false }])
  })

  it("跳过非法项和重复 id，坏数据返回空数组", () => {
    const raw = JSON.stringify([theme, { ...theme, name: "B" }, { id: "b" }, 3, null])
    expect(parseCustomThemes(raw).map((item) => item.name)).toEqual(["A"])
    expect(parseCustomThemes(null)).toEqual([])
    expect(parseCustomThemes("{bad")).toEqual([])
    expect(parseCustomThemes("{}")).toEqual([])
  })
})

describe("activeSlot", () => {
  it("不分别设置时一律用 light 槽", () => {
    const s = { ...defaultAppearance, dark: { ...defaultAppearance.dark, themeId: "nord" } }
    expect(activeSlot(s, "dark")).toBe(s.light)
    expect(activeSlot({ ...s, splitModes: true }, "dark").themeId).toBe("nord")
  })
})

describe("setOverride", () => {
  it("只写当前模式，且切换主题再切回仍保留", () => {
    const a = setOverride(defaultAppearance, "light", "bg", "#ABCDEF")
    expect(a.overrides.pigclaude).toEqual({ light: { bg: "#ABCDEF" } })
    const away = { ...a, light: { ...a.light, themeId: "nord" } }
    const back = { ...away, light: { ...away.light, themeId: "pigclaude" } }
    expect(back.overrides.pigclaude?.light?.bg).toBe("#ABCDEF")
    expect(a.overrides.pigclaude?.dark).toBeUndefined()
  })

  it("null 清除该键，并清掉空对象", () => {
    const a = setOverride(defaultAppearance, "light", "bg", "#ABCDEF")
    expect(setOverride(a, "light", "bg", null).overrides).toEqual({})
  })

  it("不修改传入对象", () => {
    setOverride(defaultAppearance, "light", "bg", "#ABCDEF")
    expect(defaultAppearance.overrides).toEqual({})
  })
})

describe("resetAppearance", () => {
  it("回默认并保留 advancedOpen", () => {
    const s = { ...defaultAppearance, advancedOpen: true, glass: 5, mode: "dark" as const }
    expect(resetAppearance(s)).toEqual({ ...defaultAppearance, advancedOpen: true })
  })
})
