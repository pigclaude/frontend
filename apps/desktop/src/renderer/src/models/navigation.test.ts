// 验证前进后退历史的规则：不重复压入、后退后再跳转截断前进记录、设置页按页区分、超长时丢掉最早的。
import { describe, expect, it } from "vitest"
import {
  canGoBack,
  canGoForward,
  createHistory,
  currentLocation,
  goBack,
  goForward,
  inShell,
  pushLocation,
  sameLocation,
  type NavLocation,
} from "./navigation"

const session: NavLocation = { kind: "session" }
const general: NavLocation = { kind: "settings", page: "general" }
const about: NavLocation = { kind: "settings", page: "about" }
const usage: NavLocation = { kind: "settings", page: "usage" }

describe("navigation history", () => {
  it("新历史不能后退也不能前进", () => {
    const history = createHistory(session)
    expect(canGoBack(history)).toBe(false)
    expect(canGoForward(history)).toBe(false)
  })

  it("后退后再前进回到原位置", () => {
    const opened = pushLocation(pushLocation(createHistory(session), general), about)
    const back = goBack(opened)
    expect(currentLocation(back)).toEqual(general)
    expect(canGoForward(back)).toBe(true)
    expect(currentLocation(goForward(back))).toEqual(about)
  })

  it("后退后打开新位置会丢掉前进记录", () => {
    const back = goBack(pushLocation(pushLocation(createHistory(session), general), about))
    const branched = pushLocation(back, usage)
    expect(branched.entries).toEqual([session, general, usage])
    expect(canGoForward(branched)).toBe(false)
  })

  it("重复打开当前位置不新增记录，边界处原样返回", () => {
    const history = createHistory(session)
    expect(pushLocation(history, { kind: "session" })).toBe(history)
    expect(goBack(history)).toBe(history)
    expect(goForward(history)).toBe(history)
  })

  it("不同的设置页、不同的整窗流程是不同的位置", () => {
    expect(sameLocation(general, { kind: "settings", page: "general" })).toBe(true)
    expect(sameLocation(general, about)).toBe(false)
    expect(sameLocation({ kind: "flow", flow: "login" }, { kind: "flow", flow: "authorize" })).toBe(
      false,
    )
    expect(sameLocation({ kind: "draft" }, session)).toBe(false)
  })

  it("最多保留 50 条记录，超出时丢掉最早的", () => {
    let history = createHistory(session)
    for (let page = 0; page < 60; page++) {
      history = pushLocation(history, { kind: "settings", page: `page-${page}` })
    }
    expect(history.entries).toHaveLength(50)
    expect(history.entries[0]).toEqual({ kind: "settings", page: "page-10" })
    expect(currentLocation(history)).toEqual({ kind: "settings", page: "page-59" })
  })

  it("只有整窗流程在外壳之外", () => {
    expect(inShell({ kind: "flow", flow: "onboarding" })).toBe(false)
    expect(inShell({ kind: "draft" })).toBe(true)
    expect(inShell(general)).toBe(true)
  })
})
