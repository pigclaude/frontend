// 校验内置主题表：数量、顺序、颜色合法性，以及按 id 查找主题的回退行为。
import { describe, expect, it } from "vitest"
import { parseHex } from "./color-math"
import { builtInThemes, findTheme } from "./theme-presets"

describe("builtInThemes", () => {
  it("按约定顺序给出 8 个内置主题", () => {
    expect(builtInThemes.map((theme) => theme.id)).toEqual([
      "pigclaude",
      "chatgpt",
      "claude",
      "linear",
      "github",
      "dracula",
      "nord",
      "solarized",
    ])
    expect(builtInThemes.map((theme) => theme.name)).toEqual([
      "pigclaude",
      "ChatGPT",
      "Claude",
      "Linear",
      "GitHub",
      "Dracula",
      "Nord",
      "Solarized",
    ])
    expect(new Set(builtInThemes.map((theme) => theme.id)).size).toBe(8)
    expect(builtInThemes.every((theme) => theme.builtIn)).toBe(true)
  })

  it("pigclaude 的颜色为 null，其余主题的颜色都是合法 Hex", () => {
    const [first, ...rest] = builtInThemes
    expect(first.light).toBeNull()
    expect(first.dark).toBeNull()
    for (const theme of rest) {
      for (const colors of [theme.light, theme.dark]) {
        expect(colors).not.toBeNull()
        expect(parseHex(colors?.bg ?? "")).not.toBeNull()
        expect(parseHex(colors?.fg ?? "")).not.toBeNull()
        expect(parseHex(colors?.accent ?? "")).not.toBeNull()
      }
    }
  })

  it("颜色与规格表一致", () => {
    expect(findTheme("solarized", []).dark).toEqual({
      bg: "#002B36",
      fg: "#93A1A1",
      accent: "#268BD2",
    })
    expect(findTheme("claude", []).light).toEqual({
      bg: "#FAF9F5",
      fg: "#141413",
      accent: "#D97757",
    })
  })
})

describe("findTheme", () => {
  it("找不到时返回 pigclaude", () => {
    expect(findTheme("nope", []).id).toBe("pigclaude")
  })

  it("能找到自定义主题", () => {
    const custom = {
      id: "mine",
      name: "我的",
      builtIn: false,
      light: { bg: "#FFFFFF", fg: "#000000" },
      dark: { bg: "#000000", fg: "#FFFFFF" },
    } as const
    expect(findTheme("mine", [custom])).toBe(custom)
  })
})
