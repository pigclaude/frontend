// 验证主题选择到实际主题的换算。
import { describe, expect, it } from "vitest"
import { parseThemePreference, resolveTheme } from "./theme-model"

describe("theme model", () => {
  it("跟随系统时按系统深色模式决定", () => {
    expect(resolveTheme("system", true)).toBe("dark")
    expect(resolveTheme("system", false)).toBe("light")
  })

  it("手动选择时忽略系统设置", () => {
    expect(resolveTheme("light", true)).toBe("light")
    expect(resolveTheme("dark", false)).toBe("dark")
  })

  it("无法识别的保存值退回跟随系统", () => {
    expect(parseThemePreference("dark")).toBe("dark")
    expect(parseThemePreference(null)).toBe("system")
    expect(parseThemePreference("purple")).toBe("system")
  })
})
