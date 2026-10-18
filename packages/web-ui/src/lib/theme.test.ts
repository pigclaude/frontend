// 负责验证共享主题恢复、切换、服务端快照与首帧初始化的行为契约。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { initTheme, toggleTheme, useIsLightTheme, themeInitializationScript } from "./theme"

let dataset: Record<string, string>
let stored: Map<string, string>

beforeEach(() => {
  dataset = {}
  stored = new Map()
  vi.stubGlobal("document", { documentElement: { dataset } })
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  })
})

afterEach(() => vi.unstubAllGlobals())

describe("共享主题", () => {
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
