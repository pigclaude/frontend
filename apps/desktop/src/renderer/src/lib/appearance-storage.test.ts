// 测试外观设置的读取、旧主题键迁移（含新键损坏时）和我的主题读写，用内存假 Storage。
import { describe, expect, it } from "vitest"
import { defaultAppearance } from "../models/appearance-settings"
import {
  appearanceKey,
  customThemesKey,
  legacyThemeKey,
  loadAppearance,
  saveAppearance,
  saveCustomThemes,
  type AppearanceStorage,
} from "./appearance-storage"

function fakeStorage(initial: Record<string, string> = {}): AppearanceStorage & {
  data: Map<string, string>
} {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  }
}

describe("loadAppearance", () => {
  it("什么都没有时返回默认值且不写入", () => {
    const storage = fakeStorage()
    expect(loadAppearance(storage).settings).toEqual(defaultAppearance)
    expect(storage.data.size).toBe(0)
  })

  it("旧键 dark 迁移成新键 mode，并删除旧键", () => {
    const storage = fakeStorage({ [legacyThemeKey]: "dark" })
    const { settings } = loadAppearance(storage)
    expect(settings.mode).toBe("dark")
    expect(storage.data.has(legacyThemeKey)).toBe(false)
    expect(JSON.parse(storage.data.get(appearanceKey) ?? "null")).toMatchObject({ mode: "dark" })
    expect(loadAppearance(storage).settings.mode).toBe("dark")
  })

  it("新键已存在时以新键为准，旧键仍被删除", () => {
    const storage = fakeStorage()
    saveAppearance(storage, { ...defaultAppearance, mode: "light" })
    storage.setItem(legacyThemeKey, "dark")
    expect(loadAppearance(storage).settings.mode).toBe("light")
    expect(storage.data.has(legacyThemeKey)).toBe(false)
  })

  it("新键损坏而旧键存在时从旧键迁移，不丢掉旧的 mode", () => {
    for (const corrupt of ["{坏", "[]", JSON.stringify({ version: 99 })]) {
      const storage = fakeStorage({ [appearanceKey]: corrupt, [legacyThemeKey]: "dark" })
      expect(loadAppearance(storage).settings.mode).toBe("dark")
      expect(storage.data.has(legacyThemeKey)).toBe(false)
      expect(JSON.parse(storage.data.get(appearanceKey) ?? "null")).toMatchObject({ mode: "dark" })
    }
  })

  it("新键损坏且没有旧键时返回默认值，不改存储", () => {
    const storage = fakeStorage({ [appearanceKey]: "{坏" })
    expect(loadAppearance(storage).settings).toEqual(defaultAppearance)
    expect(storage.data.get(appearanceKey)).toBe("{坏")
  })

  it("读出保存过的我的主题", () => {
    const storage = fakeStorage()
    const theme = {
      id: "t1",
      name: "我的",
      builtIn: false,
      light: { bg: "#FFFFFF", fg: "#111111" },
      dark: { bg: "#000000", fg: "#EEEEEE" },
    } as const
    saveCustomThemes(storage, [theme])
    expect(storage.data.has(customThemesKey)).toBe(true)
    expect(loadAppearance(storage).customThemes).toEqual([theme])
  })
})
