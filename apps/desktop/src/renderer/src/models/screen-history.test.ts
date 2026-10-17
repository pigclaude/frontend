// 验证页面历史的后退、前进和截断规则。
import { describe, expect, it } from "vitest"
import {
  canGoBack,
  canGoForward,
  createScreenHistory,
  currentScreen,
  goBack,
  goForward,
  pushScreen,
} from "./screen-history"

describe("screen history", () => {
  it("新历史不能后退也不能前进", () => {
    const history = createScreenHistory("chat")
    expect(canGoBack(history)).toBe(false)
    expect(canGoForward(history)).toBe(false)
  })

  it("后退后再前进回到原页面", () => {
    const opened = pushScreen(pushScreen(createScreenHistory("chat"), "general"), "about")
    const back = goBack(opened)
    expect(currentScreen(back)).toBe("general")
    expect(canGoForward(back)).toBe(true)
    expect(currentScreen(goForward(back))).toBe("about")
  })

  it("后退后打开新页面会丢掉前进记录", () => {
    const back = goBack(pushScreen(pushScreen(createScreenHistory("chat"), "general"), "about"))
    const branched = pushScreen(back, "usage")
    expect(branched.entries).toEqual(["chat", "general", "usage"])
    expect(canGoForward(branched)).toBe(false)
  })

  it("重复打开当前页不新增记录，边界处原样返回", () => {
    const history = createScreenHistory("chat")
    expect(pushScreen(history, "chat")).toBe(history)
    expect(goBack(history)).toBe(history)
    expect(goForward(history)).toBe(history)
  })
})
