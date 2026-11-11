// 校验主题 JSON 的导入解析与导出序列化。
import { describe, expect, it } from "vitest"
import { parseThemeFile, serializeTheme } from "./theme-file"
import { findTheme } from "./theme-presets"

const sample = JSON.stringify({
  schema: "pigclaude-theme/1",
  name: "我的蓝",
  light: { bg: "#FFFFFF", fg: "#0D0D0D", accent: "#0169CC" },
  dark: { bg: "#181818", fg: "#FFFFFF", accent: "#339CFF" },
})

const fallback = {
  light: { bg: "#F5F5F5" as const, fg: "#111111" as const },
  dark: { bg: "#1A1A1A" as const, fg: "#EEEEEE" as const },
}

function ok(text: string, names: string[] = []) {
  const result = parseThemeFile(text, names)
  if (!result.ok) throw new Error(result.reason)
  return result.theme
}

describe("parseThemeFile", () => {
  it("解析规格示例", () => {
    const theme = ok(sample)
    expect(theme.builtIn).toBe(false)
    expect(theme.name).toBe("我的蓝")
    expect(theme.light).toEqual({ bg: "#FFFFFF", fg: "#0D0D0D", accent: "#0169CC" })
    expect(theme.dark).toEqual({ bg: "#181818", fg: "#FFFFFF", accent: "#339CFF" })
    expect(theme.id.length).toBeGreaterThan(0)
  })

  it("兼容 Pigcode 主题文件 schema", () => {
    const theme = ok(sample.replace("pigclaude-theme/1", "pigcode-theme/1"))
    expect(theme.name).toBe("我的蓝")
  })

  it("缺 dark 时 dark 等于 light", () => {
    const theme = ok(
      JSON.stringify({
        schema: "pigclaude-theme/1",
        name: "x",
        light: { bg: "#FFFFFF", fg: "#000000" },
      }),
    )
    expect(theme.dark).toEqual(theme.light)
  })

  it("accent 可省略", () => {
    const theme = ok(
      JSON.stringify({
        schema: "pigclaude-theme/1",
        name: "x",
        light: { bg: "#FFFFFF", fg: "#000000" },
        dark: { bg: "#000000", fg: "#FFFFFF" },
      }),
    )
    expect(theme.light).toEqual({ bg: "#FFFFFF", fg: "#000000" })
  })

  it("非法颜色被丢弃，缺 bg 或 fg 的模式用另一模式补齐", () => {
    const theme = ok(
      JSON.stringify({
        schema: "pigclaude-theme/1",
        name: "x",
        light: { bg: "#FFFFFF", fg: "#000000", accent: "red" },
        dark: { bg: "#FFF", fg: "#FFFFFF" },
      }),
    )
    expect(theme.light).toEqual({ bg: "#FFFFFF", fg: "#000000" })
    expect(theme.dark).toEqual(theme.light)
  })

  it("两个模式都缺颜色时拒绝并提到颜色", () => {
    const result = parseThemeFile(
      JSON.stringify({ schema: "pigclaude-theme/1", name: "x", light: { bg: "red" } }),
      [],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("颜色")
  })

  it("非 JSON 文本被拒绝并提到 JSON", () => {
    const result = parseThemeFile("{bad", [])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("JSON")
  })

  it("schema 不对被拒绝并提到格式", () => {
    const result = parseThemeFile(JSON.stringify({ schema: "other", name: "x" }), [])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("格式")
  })

  it("名字重复时自动加序号", () => {
    expect(ok(sample, ["我的蓝"]).name).toBe("我的蓝 2")
    expect(ok(sample, ["我的蓝", "我的蓝 2"]).name).toBe("我的蓝 3")
  })
})

describe("serializeTheme", () => {
  it("输出能被 parseThemeFile 读回，且合并了修改", () => {
    const theme = ok(sample)
    const text = serializeTheme(theme, { light: { bg: "#EEEEEE" } }, fallback)
    const back = ok(text)
    expect(back.name).toBe("我的蓝")
    expect(back.light).toEqual({ bg: "#EEEEEE", fg: "#0D0D0D", accent: "#0169CC" })
    expect(back.dark).toEqual(theme.dark)
    expect(text).toContain('\n  "schema": "pigcode-theme/1"')
  })

  it("pigclaude 使用回退颜色，且没有 accent 时不输出 accent", () => {
    const text = serializeTheme(
      findTheme("pigclaude", []),
      { dark: { accent: "#123456" } },
      fallback,
    )
    const parsed: unknown = JSON.parse(text)
    expect(parsed).toEqual({
      schema: "pigcode-theme/1",
      name: "pigclaude",
      light: { bg: "#F5F5F5", fg: "#111111" },
      dark: { bg: "#1A1A1A", fg: "#EEEEEE", accent: "#123456" },
    })
  })
})
