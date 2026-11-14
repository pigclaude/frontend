// 验证 preload 对会话列表摘要的校验：只放行字段齐全、状态在集合里的摘要。

import { describe, expect, it } from "vitest"
import { isSessionSummary } from "./session-summary-filter"

const summary = {
  sessionId: "session-1",
  workspace: "/Users/me/app",
  status: "waiting-approval",
  lastTurn: null,
  turnId: "turn-1",
  pendingPermissions: 1,
  pendingQuestions: 0,
  accountId: "account-1",
  model: null,
  lastActivityAt: "2026-11-14T10:00:00.000Z",
}

describe("isSessionSummary", () => {
  it("accepts a complete summary in every listed status", () => {
    for (const status of [
      "queued",
      "running",
      "waiting-approval",
      "idle",
      "parked",
      "interrupted",
      "failed",
    ]) {
      expect(isSessionSummary({ ...summary, status })).toBe(true)
    }
    expect(isSessionSummary({ ...summary, lastTurn: "interrupted" })).toBe(true)
  })

  it("rejects unknown statuses, wrong field types and missing fields", () => {
    expect(isSessionSummary({ ...summary, status: "stopped" })).toBe(false)
    expect(isSessionSummary({ ...summary, lastTurn: "cancelled" })).toBe(false)
    expect(isSessionSummary({ ...summary, pendingPermissions: Number.NaN })).toBe(false)
    expect(isSessionSummary({ ...summary, workspace: 7 })).toBe(false)
    const missing: Record<string, unknown> = { ...summary }
    delete missing.lastActivityAt
    expect(isSessionSummary(missing)).toBe(false)
    expect(isSessionSummary(null)).toBe(false)
  })
})
