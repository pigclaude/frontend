// 负责验证色彩转换、极端自定义颜色及真实按钮交互态的可读性。
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { ACCENT_BG, contrastRatio, hexToOklch, oklchToHex } from "./accent-color"
import { deriveAccent } from "./accent-derive"
import { ACCENT_PRESETS } from "./accent-presets"
import { accentCss } from "./accent"

describe("accent derivation", () => {
  it("both primary button implementations consume opaque safe interaction variables", () => {
    for (const file of [
      "../components/button.tsx",
      "../../../../apps/admin/src/components/ui/button.tsx",
    ]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8")
      expect(source).toContain("bg-primary text-primary-foreground")
      expect(source).toContain("hover:bg-[var(--btn-primary-hover)]")
      expect(source).toContain("active:bg-[var(--btn-primary-active)]")
      expect(source).not.toContain("hover:bg-primary/90")
    }
  })
  it("default CSS primary normal hover and active fills also meet AA", () => {
    const source = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8")
    for (const block of source.split(":root").slice(1, 3)) {
      const resolve = (name: string): string => {
        const value = new RegExp(`--${name}: ([^;]+);`).exec(block)?.[1] ?? "#6352d9"
        const reference = /^var\(--([^)]*)\)$/.exec(value)
        return reference ? resolve(reference[1]) : value
      }
      for (const name of ["accent", "btn-primary-hover", "btn-primary-active"])
        expect(contrastRatio(resolve("accent-on"), resolve(name))).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("derived extreme colors keep AA contrast", () => {
    for (const color of ["#ffe680", "#1b1840", "#00ff00", "#8b7cf6", "#ffffff", "#000000"]) {
      const palette = deriveAccent(color)
      for (const mode of ["dark", "light"] as const) {
        expect(contrastRatio(palette[mode].accentOn, palette[mode].accent)).toBeGreaterThanOrEqual(
          4.5,
        )
        expect(contrastRatio(palette[mode].accentInk, ACCENT_BG[mode])).toBeGreaterThanOrEqual(4.5)
        expect(palette[mode].accentOn).toBe(
          contrastRatio("#ffffff", palette[mode].accent) >=
            contrastRatio("#191a1b", palette[mode].accent)
            ? "#ffffff"
            : "#191a1b",
        )
      }
    }
  })
  it("hex round trips through oklch", () => {
    for (const hex of ["#6352d9", "#000000", "#ffffff", "#ff0000"])
      expect(oklchToHex(hexToOklch(hex))).toBe(hex)
  })
  it("gamut mapping returns a valid sRGB color", () => {
    expect(oklchToHex({ l: 0.65, c: 0.8, h: 150 })).toMatch(/^#[0-9a-f]{6}$/)
  })
  it("actual normal hover and active primary fills meet AA in both modes", () => {
    for (const palette of [
      ...ACCENT_PRESETS,
      ...["#ffe680", "#1b1840", "#00ff00", "#8b7cf6", "#ffffff", "#000000"].map(deriveAccent),
    ]) {
      const blocks = accentCss(palette).split("}").filter(Boolean)
      for (const [index, mode] of (["dark", "light"] as const).entries()) {
        const css = blocks[index]
        for (const variable of ["--accent", "--btn-primary-hover", "--btn-primary-active"]) {
          const fill = new RegExp(`${variable}:(#[0-9a-f]{6});`).exec(css)?.[1]
          expect(fill).toBeDefined()
          expect(contrastRatio(palette[mode].accentOn, fill!)).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })
  it("dark hover is mixed with 10% black and light hover keeps the resting fill", () => {
    for (const palette of [...ACCENT_PRESETS, ...["#ffe680", "#12ab34"].map(deriveAccent)]) {
      const blocks = accentCss(palette).split("}").filter(Boolean)
      for (const [index, mode] of (["dark", "light"] as const).entries()) {
        const hover = /--btn-primary-hover:(#[0-9a-f]{6});/.exec(blocks[index])?.[1] ?? ""
        if (mode === "dark") {
          expect(hover).not.toBe(palette[mode].accent)
          expect(hexToOklch(hover).l).toBeCloseTo(hexToOklch(palette[mode].accent).l * 0.9, 2)
        } else expect(hover).toBe(palette[mode].accent)
      }
    }
  })
})
