// 负责验证开发期视图参数的解析：只在开发模式下认可合法页面，缺省值固定；页面名与导航位置一一对应。
import { describe, expect, it } from "vitest"
import { allScreens, locationOfScreen, parseDevView, screenOfLocation } from "./dev-view"

describe("parseDevView", () => {
  it("解析页面、主题和玻璃参数", () => {
    expect(parseDevView("?screen=accounts&theme=dark&glass=1", true)).toEqual({
      location: { kind: "settings", page: "accounts" },
      theme: "dark",
      glass: true,
    })
  })

  it("页面名不合法时返回 null", () => {
    expect(parseDevView("?screen=nope", true)).toBeNull()
  })

  it("非开发模式永远返回 null", () => {
    expect(parseDevView("?screen=accounts", false)).toBeNull()
  })

  it("缺 theme 时用 light，缺 glass 时为 false", () => {
    expect(parseDevView("?screen=chat", true)).toEqual({
      location: { kind: "session" },
      theme: "light",
      glass: false,
    })
  })

  it("只在对应页面上认可 phase 和 step", () => {
    expect(parseDevView("?screen=login&phase=waiting", true)?.phase).toBe("waiting")
    expect(parseDevView("?screen=login&phase=nope", true)?.phase).toBeUndefined()
    expect(parseDevView("?screen=chat&phase=waiting", true)?.phase).toBeUndefined()
    expect(parseDevView("?screen=onboarding&step=session", true)?.step).toBe("session")
    expect(parseDevView("?screen=login&step=session", true)?.step).toBeUndefined()
  })

  it("只在会话页上认可演示工作台", () => {
    expect(parseDevView("?screen=chat-new&workbench=1", true)?.workbench).toBe(true)
    expect(parseDevView("?screen=chat&workbench=1", true)?.workbench).toBe(true)
    expect(parseDevView("?screen=chat", true)).not.toHaveProperty("workbench")
    expect(parseDevView("?screen=about&workbench=1", true)).not.toHaveProperty("workbench")
  })
})

describe("页面名与导航位置", () => {
  it("新会话、会话、托盘与整窗流程有各自的位置", () => {
    expect(locationOfScreen("chat-new")).toEqual({ kind: "draft" })
    expect(locationOfScreen("tray")).toEqual({ kind: "tray" })
    expect(locationOfScreen("authorize")).toEqual({ kind: "flow", flow: "authorize" })
    expect(locationOfScreen("menubar")).toEqual({ kind: "settings", page: "menubar" })
  })

  it("每个页面名转成位置再转回来不变", () => {
    for (const name of allScreens) {
      expect(screenOfLocation(locationOfScreen(name))).toBe(name)
    }
  })
})
