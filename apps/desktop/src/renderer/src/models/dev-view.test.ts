// 负责验证开发期视图参数的解析：只在开发模式下认可合法页面，缺省值固定。
import { describe, expect, it } from "vitest"
import { parseDevView } from "./dev-view"

describe("parseDevView", () => {
  it("解析页面、主题和玻璃参数", () => {
    expect(parseDevView("?screen=accounts&theme=dark&glass=1", true)).toEqual({
      screen: "accounts",
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
      screen: "chat",
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
})
