// 负责验证预设顺序、精确旧值及默认样式的主题色契约。
import ts from "typescript"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { ACCENT_PRESETS, DEFAULT_ACCENT } from "./accent-presets"
import { ACCENT_BG, contrastRatio } from "./accent-color"
import { accentCss } from "./accent"

describe("accent presets", () => {
  it("presets are complete static literal tables without runtime dependencies", () => {
    const source = readFileSync(new URL("./accent-presets.ts", import.meta.url), "utf8")
    const syntax = ts.createSourceFile("accent-presets.ts", source, ts.ScriptTarget.Latest, true)
    expect(syntax.statements.some(ts.isImportDeclaration)).toBe(false)
    const declaration = syntax.statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) => [...statement.declarationList.declarations])
      .find((entry) => entry.name.getText(syntax) === "ACCENT_PRESETS")
    expect(declaration?.initializer && ts.isArrayLiteralExpression(declaration.initializer)).toBe(
      true,
    )
    if (!declaration?.initializer || !ts.isArrayLiteralExpression(declaration.initializer)) return
    const presets = declaration.initializer.elements
    expect(presets).toHaveLength(8)
    function literalObject(node: ts.Node): boolean {
      return (
        ts.isObjectLiteralExpression(node) &&
        node.properties.every(
          (property) =>
            ts.isPropertyAssignment(property) &&
            (ts.isStringLiteral(property.initializer) || literalObject(property.initializer)),
        )
      )
    }
    expect(presets.every(literalObject)).toBe(true)
  })
  it("every preset meets AA in both modes", () => {
    for (const preset of ACCENT_PRESETS)
      for (const mode of ["dark", "light"] as const) {
        expect(contrastRatio(preset[mode].accentOn, preset[mode].accent)).toBeGreaterThanOrEqual(
          4.5,
        )
        expect(contrastRatio(preset[mode].accentInk, ACCENT_BG[mode])).toBeGreaterThanOrEqual(4.5)
      }
  })
  it("indigo preset equals specified tokens", () => {
    expect(ACCENT_PRESETS[0]).toEqual({
      id: "indigo",
      label: "靛紫",
      brand: "#8b7cf6",
      dark: {
        accent: "#6352d9",
        accentOn: "#ffffff",
        accentHover: "#8b7cf6",
        accentActive: "#4c3db8",
        accentGlow: "#8b7cf6",
        accentInk: "#8b7cf6",
        landingInkFrom: "#c9c1fd",
        landingInkTo: "#8b7cf6",
      },
      light: {
        accent: "#6352d9",
        accentOn: "#ffffff",
        accentHover: "#6352d9",
        accentActive: "#4c3db8",
        accentGlow: "#8b7cf6",
        accentInk: "#6352d9",
        landingInkFrom: "#8b7cf6",
        landingInkTo: "#6352d9",
      },
    })
  })
  it("blue preset equals legacy tokens", () => {
    expect(ACCENT_PRESETS.find((p) => p.id === "blue")).toEqual({
      id: "blue",
      label: "蓝",
      brand: "#3a83f7",
      dark: {
        accent: "#2c67c5",
        accentOn: "#ffffff",
        accentHover: "#3a83f7",
        accentActive: "#1f4e94",
        accentGlow: "#3a83f7",
        accentInk: "#3a83f7",
        landingInkFrom: "#a9cffb",
        landingInkTo: "#3a83f7",
      },
      light: {
        accent: "#2c67c5",
        accentOn: "#ffffff",
        accentHover: "#3a83f7",
        accentActive: "#1f4e94",
        accentGlow: "#3a83f7",
        accentInk: "#2c67c5",
        landingInkFrom: "#3a83f7",
        landingInkTo: "#2c67c5",
      },
    })
  })
  it("blue light-mode primary hover keeps the legacy 10% darken", () => {
    const blue = ACCENT_PRESETS.find((p) => p.id === "blue")!
    const light = accentCss(blue).split("}")[1]
    expect(light).toContain("--btn-primary-hover:#2c67c5;")
  })
  it("presets are indigo first and unique", () => {
    expect(DEFAULT_ACCENT).toBe("indigo")
    expect(ACCENT_PRESETS.map((p) => p.id)).toEqual([
      "indigo",
      "blue",
      "rose",
      "clay",
      "teal",
      "green",
      "red",
      "amber",
    ])
    expect(new Set(ACCENT_PRESETS.map((p) => p.id)).size).toBe(8)
    expect(ACCENT_PRESETS.find((p) => p.id === "rose")?.brand).toBe("#ec6f8f")
  })
  it("tokens.css defaults to indigo", () => {
    const css = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8")
    for (const value of [
      "--accent: #6352d9",
      "--accent-hover: #8b7cf6",
      "--accent-active: #4c3db8",
      "--accent-glow: #8b7cf6",
      "--landing-ink-from: #c9c1fd",
      "--landing-ink-to: #8b7cf6",
    ])
      expect(css).toContain(value)
    expect(css).not.toContain("#3a83f7")
    expect(css).not.toMatch(/--landing-ink-(?:from|to): var\(--landing-ink/)
  })
})
