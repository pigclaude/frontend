// 校验「我的主题」入库前的整理：名字去空白、限长、去重，id 不与内置或已有主题冲突。
import { describe, expect, it } from "vitest"
import { maxThemeNameLength, prepareCustomTheme, uniqueThemeName } from "./theme-library"
import type { ThemeDefinition } from "./theme-presets"

const colors = { bg: "#FFFFFF", fg: "#000000" } as const

function theme(id: string, name: string): ThemeDefinition {
  return { id, name, builtIn: false, light: colors, dark: colors }
}

describe("uniqueThemeName", () => {
  it("不重复时只去掉首尾空白", () => {
    expect(uniqueThemeName("  我的蓝 ", [])).toBe("我的蓝")
  })

  it("重复时加序号", () => {
    expect(uniqueThemeName("我的蓝", ["我的蓝"])).toBe("我的蓝 2")
    expect(uniqueThemeName("我的蓝", ["我的蓝", "我的蓝 2"])).toBe("我的蓝 3")
  })

  it("空名字换成「未命名主题」", () => {
    expect(uniqueThemeName("   ", [])).toBe("未命名主题")
  })

  it("超长名字截到上限，按字符而不是 UTF-16 单元计", () => {
    const long = "蓝".repeat(60)
    expect(Array.from(uniqueThemeName(long, []))).toHaveLength(maxThemeNameLength)
    const emoji = "🐷".repeat(50)
    const result = uniqueThemeName(emoji, [])
    expect(Array.from(result)).toHaveLength(maxThemeNameLength)
    expect(result).toBe("🐷".repeat(maxThemeNameLength))
  })

  it("加序号后也不超过上限", () => {
    const capped = "a".repeat(maxThemeNameLength)
    const result = uniqueThemeName("a".repeat(80), [capped])
    expect(result.length).toBeLessThanOrEqual(maxThemeNameLength)
    expect(result).not.toBe(capped)
    expect(result.endsWith(" 2")).toBe(true)
  })
})

describe("prepareCustomTheme", () => {
  it("名字与内置主题和我的主题都不重复", () => {
    const result = prepareCustomTheme(theme("x", "ChatGPT"), [theme("a", "ChatGPT 2")], () => "1")
    expect(result.name).toBe("ChatGPT 3")
  })

  it("id 总是 custom- 开头，不会与内置主题 id 相同", () => {
    const result = prepareCustomTheme(theme("chatgpt", "蓝"), [], () => "abc")
    expect(result.id).toBe("custom-abc")
    expect(result.builtIn).toBe(false)
  })

  it("生成的 id 与已有主题冲突时换一个", () => {
    const ids = ["dup", "dup", "fresh"]
    const result = prepareCustomTheme(theme("x", "蓝"), [theme("custom-dup", "旧")], () => {
      return ids.shift() ?? "never"
    })
    expect(result.id).toBe("custom-fresh")
  })

  it("不修改传入的主题", () => {
    const input = theme("x", "  蓝  ")
    prepareCustomTheme(input, [], () => "1")
    expect(input).toEqual(theme("x", "  蓝  "))
  })
})
