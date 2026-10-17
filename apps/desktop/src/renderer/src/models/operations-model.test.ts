// 验证用量筛选、端口校验和清除记录确认状态。
import { describe, expect, it } from "vitest"
import {
  filterUsageRows,
  reducePrivacyState,
  validateRelayPort,
  type UsageRow,
} from "./operations-model"

const rows: UsageRow[] = [
  { id: "a", kind: "all", model: "Opus", status: 200 },
  { id: "b", kind: "switch", model: "Sonnet", status: 429 },
  { id: "c", kind: "error", model: "Haiku", status: 503 },
]

describe("operations model", () => {
  it("按全部、换号和错误筛选请求记录", () => {
    expect(filterUsageRows(rows, "all")).toHaveLength(3)
    expect(filterUsageRows(rows, "switch").map((row) => row.id)).toEqual(["b"])
    expect(filterUsageRows(rows, "error").map((row) => row.id)).toEqual(["c"])
  })

  it("只接受 1024 到 65535 的中继端口", () => {
    expect(validateRelayPort("1024")).toBe(true)
    expect(validateRelayPort("65535")).toBe(true)
    expect(validateRelayPort("1023")).toBe(false)
    expect(validateRelayPort("70000")).toBe(false)
    expect(validateRelayPort("abc")).toBe(false)
  })

  it("清除用量必须确认，取消不清空", () => {
    const initial = { open: false, cleared: false }
    const opened = reducePrivacyState(initial, { type: "open-clear" })
    expect(reducePrivacyState(opened, { type: "cancel-clear" })).toMatchObject({
      open: false,
      cleared: false,
    })
    expect(reducePrivacyState(opened, { type: "confirm-clear" })).toMatchObject({
      open: false,
      cleared: true,
    })
  })
})
