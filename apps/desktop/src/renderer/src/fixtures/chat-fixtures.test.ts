// 验证会话 fixture 只保存脱敏展示数据，不保存正文或凭据。
import { describe, expect, it } from "vitest"
import { sessionFixture } from "./chat-fixtures"

describe("chat fixture", () => {
  it("包含新会话建议和进行中会话展示数据", () => {
    expect(sessionFixture.suggestions).toHaveLength(4)
    expect(sessionFixture.steps.length).toBeGreaterThan(0)
    expect(sessionFixture.diff.files.length).toBeGreaterThan(0)
    expect(JSON.stringify(sessionFixture)).not.toMatch(/credential|prompt|reply/i)
  })
})
