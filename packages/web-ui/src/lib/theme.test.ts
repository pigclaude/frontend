// 负责验证共享主题恢复、切换、服务端快照与首帧初始化的行为契约。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { initTheme, toggleTheme, useIsLightTheme, themeInitializationScript } from "./theme"

import { accentCss, applyAccent, paletteFor, readAccent, ACCENT_STORAGE_KEY } from "./accent"

const fallback = { kind: "preset", id: "indigo" }
let dataset: DOMStringMap
let stored: Map<string, string>

beforeEach(() => {
  dataset = document.documentElement.dataset
  delete dataset.theme
  document.getElementById("pigclaude-accent")?.remove()
  stored = new Map()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  })
})

afterEach(() => vi.unstubAllGlobals())

describe("共享主题", () => {
  it("init script ignores invalid or stale accent storage", () => {
    applyAccent({ kind: "preset", id: "rose" })
    const valid = JSON.parse(localStorage.getItem(ACCENT_STORAGE_KEY)!)
    for (const raw of [
      "{oops",
      ...[
        null,
        { ...valid, v: 0 },
        { ...valid, css: valid.css + "body{display:none}" },
        { ...valid, css: "html:root{--accent:#ffffff;}" },
        { ...valid, choice: { kind: "preset", id: "unknown" } },
        { ...valid, choice: { kind: "preset", id: "blue" } },
        { ...valid, choice: { kind: "custom", hex: "#12ab34" } },
        { ...valid, css: 42 },
      ].map((value) => JSON.stringify(value)),
    ]) {
      document.getElementById("pigclaude-accent")?.remove()
      localStorage.setItem(ACCENT_STORAGE_KEY, raw)
      expect(readAccent()).toEqual(fallback)
      expect(() => Function(themeInitializationScript)()).not.toThrow()
      expect(document.getElementById("pigclaude-accent")).toBeNull()
    }
  })
  it("restores valid preset and custom caches before React without duplicate nodes or comments", () => {
    for (const choice of [
      { kind: "preset", id: "blue" },
      { kind: "custom", hex: "#12ab34" },
    ] as const) {
      applyAccent(choice)
      const css = accentCss(paletteFor(choice))
      document.getElementById("pigclaude-accent")?.remove()
      Function(themeInitializationScript)()
      Function(themeInitializationScript)()
      expect(document.querySelectorAll("#pigclaude-accent")).toHaveLength(1)
      expect(document.getElementById("pigclaude-accent")?.textContent).toBe(css)
      expect(readAccent()).toEqual(choice)
    }
    expect(themeInitializationScript).not.toMatch(/\/\/|\/\*/)
  })

  it("只恢复 Pigclaude 的亮色选择，缺省和无效值使用暗色", () => {
    stored.set("pigcursor-theme", "light")
    initTheme()
    expect(dataset.theme).toBeUndefined()
    stored.set("pigclaude-theme", "light")
    initTheme()
    expect(dataset.theme).toBe("light")
    stored.set("pigclaude-theme", "invalid")
    initTheme()
    expect(dataset.theme).toBeUndefined()
  })

  it("连续切换同步 DOM 与持久化值", () => {
    toggleTheme()
    expect(dataset.theme).toBe("light")
    expect(stored.get("pigclaude-theme")).toBe("light")
    toggleTheme()
    expect(dataset.theme).toBeUndefined()
    expect(stored.get("pigclaude-theme")).toBe("dark")
  })

  it("存储不可用时切换仍然更新页面且初始化不抛错", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
    })
    expect(() => initTheme()).not.toThrow()
    expect(() => Function(themeInitializationScript)()).not.toThrow()
    toggleTheme()
    expect(dataset.theme).toBe("light")
    toggleTheme()
    expect(dataset.theme).toBeUndefined()
  })

  it("首帧脚本在 React 加载前恢复亮色并清理过期 DOM 状态", () => {
    stored.set("pigclaude-theme", "light")
    Function(themeInitializationScript)()
    expect(dataset.theme).toBe("light")
    stored.delete("pigclaude-theme")
    Function(themeInitializationScript)()
    expect(dataset.theme).toBeUndefined()
  })

  it("主题 Hook 的服务端快照固定为暗色，避免读取浏览器状态", () => {
    function ThemeLabel() {
      return createElement("span", null, useIsLightTheme() ? "light" : "dark")
    }
    dataset.theme = "light"
    expect(renderToString(createElement(ThemeLabel))).toBe("<span>dark</span>")
  })
})
