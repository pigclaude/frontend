// 验证账号与代理 fixture 的确认、绑定和测试状态。
import { describe, expect, it } from "vitest"
import { createPoolState, reducePoolState } from "./pool-model"

describe("pool model", () => {
  it("取消删除不改变账号数据，确认删除才移除账号", () => {
    const initial = createPoolState()
    const opened = reducePoolState(initial, { type: "open-delete", accountId: "legacy" })
    const cancelled = reducePoolState(opened, { type: "cancel-dialog" })
    expect(cancelled.accounts).toBe(opened.accounts)
    const confirmed = reducePoolState(opened, { type: "confirm-delete" })
    expect(confirmed.accounts.some((account) => account.id === "legacy")).toBe(false)
  })

  it("绑定代理更新账号关系，测试状态可以恢复", () => {
    const initial = createPoolState()
    const bound = reducePoolState(initial, {
      type: "bind-proxy",
      accountId: "backup",
      proxyId: "la-01",
    })
    expect(bound.accounts.find((account) => account.id === "backup")?.proxyId).toBe("la-01")
    const testing = reducePoolState(bound, { type: "start-test", proxyId: "la-01" })
    expect(testing.testingProxyId).toBe("la-01")
    expect(
      reducePoolState(testing, { type: "finish-test", proxyId: "la-01" }).testingProxyId,
    ).toBeNull()
  })
})
