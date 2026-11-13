// 验证旧外观迁移保留用户模式、主题与设置，新格式可继续读写。
import { describe, expect, it } from "vitest"
import { defaultAppearance, exportCurrentTheme, importTheme } from "@pigclaude/ui-primitives"
import { migrateAppearance, migrateAppearanceStorage } from "./appearance-migration"

describe("旧外观迁移", () => {
  it.each(["light", "dark", "system"] as const)("保留 %s 模式与旧默认主题的颜色", (mode) => {
    const legacy = JSON.stringify({
      version: 1,
      mode,
      glass: 35,
      dockIcon: "pink",
      uiSize: 17,
      contentSize: 15,
      codeSize: 12,
      overrides: { pigclaude: { light: { bg: "#123456" } } },
    })
    const { settings } = migrateAppearance(legacy, null, null)
    expect(settings).toMatchObject({
      mode,
      sidebarTranslucency: 35,
      dockIcon: "pink",
      uiSize: 17,
      contentSize: 15,
      codeSize: 12,
      light: { themeId: defaultAppearance.light.themeId },
      overrides: { [defaultAppearance.light.themeId]: { light: { bg: "#123456" } } },
    })
    expect(settings.overrides["pigclaude"]).toBeUndefined()
  })

  it("保留自定义主题，坏设置落回默认", () => {
    const custom = {
      id: "theme-custom",
      name: "我的主题",
      light: { bg: "#ffffff", fg: "#111111" },
      dark: { bg: "#000000", fg: "#eeeeee" },
    }
    const raw = JSON.stringify({ version: 1, light: { themeId: custom.id } })
    const result = migrateAppearance(raw, JSON.stringify([custom]), null)
    expect(result.settings.light.themeId).toBe(custom.id)
    expect(result.customThemes[0]).toMatchObject({ id: custom.id, name: custom.name })
    expect(migrateAppearance("{", "{", null)).toMatchObject({
      settings: { mode: "system", sidebarTranslucency: 0, uiSize: 13 },
      customThemes: [],
    })
  })

  it("不会用旧值覆盖已经写入的新设置", () => {
    const data = new Map([["pigclaude-appearance", JSON.stringify({ version: 1, mode: "dark" })]])
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value)
      },
      removeItem: (key: string) => {
        data.delete(key)
      },
    }
    migrateAppearanceStorage(storage)
    expect(JSON.parse(data.get("pigcode-appearance") ?? "null")).toMatchObject({ mode: "dark" })
    data.set("pigcode-appearance", JSON.stringify({ version: 1, mode: "light" }))
    migrateAppearanceStorage(storage)
    expect(JSON.parse(data.get("pigcode-appearance") ?? "null")).toMatchObject({ mode: "light" })
  })

  it.each(["pigclaude-theme/1", "pigcode-theme/1"])("导入 %s，仍导出 Pigcode 文件", (schema) => {
    const raw = JSON.stringify({
      schema,
      name: "演示",
      light: { bg: "#ffffff", fg: "#111111", diffAdded: "#155832" },
    })
    const imported = importTheme(raw, "演示", [])
    expect(imported.ok && imported.theme.light?.diffAdded).toBe("#155832")
    expect(JSON.parse(exportCurrentTheme(defaultAppearance, []).text).schema).toBe(
      "pigcode-theme/1",
    )
  })
})
