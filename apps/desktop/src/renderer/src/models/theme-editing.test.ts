// 校验外观页编辑主题的纯规则：编辑哪个模式、显示的颜色、「已修改」判断、还原、分别设置和删除主题。
import { describe, expect, it } from "vitest"
import type { AppearanceSettings } from "./appearance-settings"
import { defaultAppearance, setOverride } from "./appearance-settings"
import {
  bakeTheme,
  editTone,
  adoptSavedTheme,
  exportTheme,
  forgetTheme,
  isThemeModified,
  restoreTheme,
  selectTheme,
  setAccentMode,
  setSplitModes,
  setThemeColor,
  shownColors,
  pigclaudeColors,
} from "./theme-editing"
import type { ThemeDefinition } from "./theme-presets"

const base: AppearanceSettings = defaultAppearance
const mine: ThemeDefinition = {
  id: "custom-1",
  name: "我的蓝",
  builtIn: false,
  light: { bg: "#FFFFFF", fg: "#111111" },
  dark: { bg: "#000000", fg: "#EEEEEE", accent: "#339CFF" },
}

describe("editTone", () => {
  it("不分别设置时编辑当前显示的模式", () => {
    expect(editTone(base, "dark", "light")).toBe("dark")
  })
  it("分别设置时编辑分段选中的模式", () => {
    expect(editTone({ ...base, splitModes: true }, "dark", "light")).toBe("light")
  })
})

describe("shownColors", () => {
  it("pigclaude 用 tokens 原值对应的 hex", () => {
    expect(shownColors(base, [], "light").colors).toEqual(pigclaudeColors.light)
    expect(shownColors(base, [], "dark").colors.bg).toBe("#232325")
  })

  it("合并当前模式的修改，不影响另一个模式", () => {
    const changed = setOverride(base, "light", "bg", "#ABCDEF")
    expect(shownColors(changed, [], "light").colors.bg).toBe("#ABCDEF")
    expect(shownColors(changed, [], "dark").colors.bg).toBe("#232325")
  })

  it("强调色为默认时忽略强调色修改", () => {
    const changed = setOverride(selectTheme(base, "light", "chatgpt"), "light", "accent", "#FF0000")
    expect(shownColors(changed, [], "light").colors.accent).toBe("#339CFF")
  })

  it("主题没有强调色时回退到 pigclaude 的强调色", () => {
    const settings = selectTheme(base, "light", "custom-1")
    expect(shownColors(settings, [mine], "light").colors.accent).toBe(pigclaudeColors.light.accent)
    expect(shownColors(settings, [mine], "light").theme.id).toBe("custom-1")
  })
})

describe("isThemeModified", () => {
  it("没有修改时为 false", () => {
    expect(isThemeModified(base, "light")).toBe(false)
  })
  it("改了背景或前景时为 true，只看该模式", () => {
    const changed = setOverride(base, "dark", "fg", "#FFFFFF")
    expect(isThemeModified(changed, "dark")).toBe(true)
    expect(isThemeModified(changed, "light")).toBe(false)
  })
  it("强调色修改只在自定义强调色时算修改", () => {
    const changed = setOverride(base, "light", "accent", "#FF0000")
    expect(isThemeModified(changed, "light")).toBe(false)
    const custom = { ...changed, light: { ...changed.light, accentMode: "custom" as const } }
    expect(isThemeModified(custom, "light")).toBe(true)
  })
})

describe("restoreTheme", () => {
  it("只清掉当前主题当前模式的修改", () => {
    let settings = setOverride(base, "light", "bg", "#ABCDEF")
    settings = setOverride(settings, "dark", "bg", "#123456")
    const restored = restoreTheme(settings, "light")
    expect(restored.overrides.pigclaude?.light).toBeUndefined()
    expect(restored.overrides.pigclaude?.dark?.bg).toBe("#123456")
  })
})

describe("restoreTheme 与强调色", () => {
  it("还原时把该槽的强调色方式改回默认", () => {
    const custom = setAccentMode(base, [], "light", "custom")
    const restored = restoreTheme(custom, "light")
    expect(restored.light.accentMode).toBe("default")
    expect(restored.overrides).toEqual({})
  })
  it("分别设置时只改被还原的那个槽", () => {
    let settings = setSplitModes(base, true)
    settings = setAccentMode(settings, [], "dark", "custom")
    settings = setAccentMode(settings, [], "light", "custom")
    const restored = restoreTheme(settings, "light")
    expect(restored.light.accentMode).toBe("default")
    expect(restored.dark.accentMode).toBe("custom")
    expect(restored.overrides.pigclaude?.dark?.accent).toBe(pigclaudeColors.dark.accent)
  })
})

describe("selectTheme", () => {
  it("不分别设置时写 light 槽", () => {
    const next = selectTheme(base, "dark", "nord")
    expect(next.light.themeId).toBe("nord")
    expect(next.dark.themeId).toBe("pigclaude")
  })
  it("分别设置时只写对应槽", () => {
    const next = selectTheme({ ...base, splitModes: true }, "dark", "nord")
    expect(next.dark.themeId).toBe("nord")
    expect(next.light.themeId).toBe("pigclaude")
  })
})

describe("setSplitModes", () => {
  it("打开时深色槽沿用当前共用的选择，界面不跳变", () => {
    const shared = selectTheme(base, "light", "nord")
    const next = setSplitModes(shared, true)
    expect(next.splitModes).toBe(true)
    expect(next.dark).toEqual(next.light)
  })
  it("关闭时保留两个槽", () => {
    const split = selectTheme(setSplitModes(base, true), "dark", "claude")
    const next = setSplitModes(split, false)
    expect(next.splitModes).toBe(false)
    expect(next.dark.themeId).toBe("claude")
  })
})

describe("setAccentMode", () => {
  it("pigclaude 切到自定义时写入 pigclaude 强调色，让变化立即可见", () => {
    const next = setAccentMode(base, [], "light", "custom")
    expect(next.light.accentMode).toBe("custom")
    expect(next.overrides.pigclaude?.light?.accent).toBe(pigclaudeColors.light.accent)
  })
  it("有强调色的主题切到自定义时不写修改", () => {
    const next = setAccentMode(selectTheme(base, "light", "chatgpt"), [], "light", "custom")
    expect(next.overrides).toEqual({})
  })
  it("没有强调色的自定义主题切到自定义时也写入起始强调色", () => {
    const next = setAccentMode(selectTheme(base, "light", "custom-1"), [mine], "light", "custom")
    expect(next.overrides["custom-1"]?.light?.accent).toBe(pigclaudeColors.light.accent)
  })
  it("不分别设置时切回默认，两个模式的强调色修改都清掉", () => {
    let settings = setAccentMode(base, [], "light", "custom")
    settings = setOverride(settings, "dark", "accent", "#123456")
    const next = setAccentMode(settings, [], "dark", "default")
    expect(next.overrides).toEqual({})
  })
  it("分别设置时切回默认只清该模式", () => {
    let settings = setSplitModes(base, true)
    settings = setAccentMode(settings, [], "light", "custom")
    settings = setAccentMode(settings, [], "dark", "custom")
    const next = setAccentMode(settings, [], "dark", "default")
    expect(next.overrides.pigclaude?.light?.accent).toBe(pigclaudeColors.light.accent)
    expect(next.overrides.pigclaude?.dark).toBeUndefined()
  })
  it("切回默认时清掉强调色修改", () => {
    const custom = setAccentMode(base, [], "light", "custom")
    const next = setAccentMode(custom, [], "light", "default")
    expect(next.light.accentMode).toBe("default")
    expect(next.overrides).toEqual({})
  })
})

describe("bakeTheme", () => {
  it("把两个模式的修改合进主题颜色", () => {
    const settings = setOverride(base, "dark", "bg", "#101010")
    const baked = bakeTheme(settings, [], "light")
    expect(baked.dark.bg).toBe("#101010")
    expect(baked.light).toEqual({ bg: "#F4F4F5", fg: "#18181B" })
  })
  it("强调色为默认时不写入修改的强调色", () => {
    const settings = setOverride(
      selectTheme(base, "light", "chatgpt"),
      "light",
      "accent",
      "#FF0000",
    )
    expect(bakeTheme(settings, [], "light").light.accent).toBe("#339CFF")
  })
})

describe("forgetTheme", () => {
  it("用到被删主题的槽回到 pigclaude，并删掉它的修改", () => {
    let settings = selectTheme(setSplitModes(base, true), "dark", "custom-1")
    settings = setOverride(settings, "dark", "bg", "#000001")
    const next = forgetTheme(settings, "custom-1")
    expect(next.dark.themeId).toBe("pigclaude")
    expect(next.overrides["custom-1"]).toBeUndefined()
  })
})

describe("adoptSavedTheme", () => {
  it("切到新存的主题，并清掉原主题已合进新主题的修改", () => {
    let settings = setOverride(selectTheme(base, "light", "nord"), "light", "bg", "#ABCDEF")
    settings = setOverride(settings, "dark", "fg", "#FEDCBA")
    const next = adoptSavedTheme(settings, "light", "custom-9")
    expect(next.light.themeId).toBe("custom-9")
    expect(next.overrides.nord).toBeUndefined()
  })
})

describe("adoptSavedTheme 分别设置", () => {
  it("两个槽都用原主题时一起切到新主题，深色的修改经新主题保留", () => {
    let settings = selectTheme(setSplitModes(base, true), "light", "nord")
    settings = selectTheme(settings, "dark", "nord")
    settings = setOverride(settings, "dark", "bg", "#101820")
    const baked = bakeTheme(settings, [], "light")
    const saved: ThemeDefinition = { id: "custom-9", name: "新", builtIn: false, ...baked }
    const next = adoptSavedTheme(settings, "light", "custom-9")
    expect(next.light.themeId).toBe("custom-9")
    expect(next.dark.themeId).toBe("custom-9")
    expect(shownColors(next, [saved], "dark").colors.bg).toBe("#101820")
    expect(next.overrides.nord).toBeUndefined()
  })
  it("另一个槽用别的主题时不动它，也不删原主题另一模式的修改", () => {
    let settings = selectTheme(setSplitModes(base, true), "light", "nord")
    settings = setOverride(settings, "light", "bg", "#ABCDEF")
    settings = selectTheme(settings, "dark", "claude")
    settings = selectTheme(settings, "dark", "nord")
    settings = setOverride(settings, "dark", "fg", "#FEDCBA")
    settings = selectTheme(settings, "dark", "claude")
    const next = adoptSavedTheme(settings, "light", "custom-9")
    expect(next.light.themeId).toBe("custom-9")
    expect(next.dark.themeId).toBe("claude")
    expect(next.overrides.nord).toEqual({ dark: { fg: "#FEDCBA" } })
  })
})

describe("exportTheme", () => {
  it("强调色为默认时不导出隐藏的强调色修改", () => {
    const settings = setOverride(
      selectTheme(base, "light", "chatgpt"),
      "light",
      "accent",
      "#FF0000",
    )
    const json = JSON.parse(exportTheme(settings, [], "light"))
    expect(json.light.accent).toBe("#339CFF")
    expect(json.name).toBe("ChatGPT")
  })
  it("导出当前主题含两个模式的修改", () => {
    let settings = setAccentMode(base, [], "light", "custom")
    settings = setOverride(settings, "dark", "bg", "#101010")
    const json = JSON.parse(exportTheme(settings, [], "light"))
    expect(json.schema).toBe("pigcode-theme/1")
    expect(json.light.accent).toBe(pigclaudeColors.light.accent)
    expect(json.dark.bg).toBe("#101010")
  })
})

describe("setThemeColor", () => {
  it("写入与主题原值不同的颜色", () => {
    const next = setThemeColor(base, [], "light", "bg", "#ABCDEF")
    expect(next.overrides.pigclaude?.light?.bg).toBe("#ABCDEF")
    expect(isThemeModified(next, "light")).toBe(true)
  })
  it("颜色等于主题原值时清掉修改，pigclaude 回到原始 tokens（大小写不敏感）", () => {
    const changed = setThemeColor(base, [], "light", "bg", "#ABCDEF")
    const next = setThemeColor(changed, [], "light", "bg", "#f4f4f5")
    expect(next.overrides.pigclaude).toBeUndefined()
    expect(isThemeModified(next, "light")).toBe(false)
  })
  it("内置主题按自己的原值判断", () => {
    let settings = setAccentMode(selectTheme(base, "light", "chatgpt"), [], "light", "custom")
    settings = setThemeColor(settings, [], "light", "accent", "#FF0000")
    expect(isThemeModified(settings, "light")).toBe(true)
    settings = setThemeColor(settings, [], "light", "accent", "#339cff")
    expect(settings.overrides.chatgpt).toBeUndefined()
    expect(isThemeModified(settings, "light")).toBe(false)
  })
  it("只清掉这一项，保留同模式的其它修改", () => {
    let settings = setThemeColor(base, [], "dark", "fg", "#111111")
    settings = setThemeColor(settings, [], "dark", "bg", "#000000")
    settings = setThemeColor(settings, [], "dark", "bg", "#232325")
    expect(settings.overrides.pigclaude).toEqual({ dark: { fg: "#111111" } })
  })
})
