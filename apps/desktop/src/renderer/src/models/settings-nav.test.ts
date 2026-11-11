// 验证设置侧栏搜索按名称和设置项过滤。
import { describe, expect, it } from "vitest"
import { filterSettingsNav, settingsNav, settingsPages } from "./settings-nav"

describe("settings nav", () => {
  it("空查询返回全部分组", () => {
    expect(filterSettingsNav(settingsNav, "  ")).toBe(settingsNav)
  })

  it("按页面里的设置项命中并去掉空分组", () => {
    const result = filterSettingsNav(settingsNav, "端口")
    expect(result.map((group) => group.label)).toEqual(["应用"])
    expect(result[0]?.items.map((item) => item.page)).toEqual(["network"])
  })

  it("英文不区分大小写", () => {
    const pages = filterSettingsNav(settingsNav, "dock").flatMap((group) =>
      group.items.map((item) => item.page),
    )
    expect(pages).toEqual(["general"])
  })

  it("没有命中时返回空列表", () => {
    expect(filterSettingsNav(settingsNav, "不存在的设置")).toEqual([])
  })

  it("托盘与菜单栏属于设置页面", () => {
    expect(settingsPages.has("menubar")).toBe(true)
    expect(settingsPages.has("chat")).toBe(false)
  })
})
