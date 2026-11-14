// 负责验证子代理标签状态的存储：按会话分开保存，改动时通知订阅者，回收后回到初始状态。

import { describe, expect, it, vi } from "vitest"
import { SubagentTabStore } from "./subagent-tab-store"
import { initialSubagentTabs, openSubagentTab } from "./subagent-tabs"

describe("SubagentTabStore", () => {
  it("keeps each session's tabs apart and tells subscribers about changes", () => {
    const store = new SubagentTabStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.update("s-1", (state) => openSubagentTab(state, "call-1"))

    expect(store.read("s-1").selected).toEqual({ kind: "subagent", subagentId: "call-1" })
    expect(store.read("s-2")).toBe(initialSubagentTabs)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("forgets an ended session's tabs", () => {
    const store = new SubagentTabStore()
    store.update("s-1", (state) => openSubagentTab(state, "call-1"))

    store.forget("s-1")

    expect(store.read("s-1")).toBe(initialSubagentTabs)
  })
})
