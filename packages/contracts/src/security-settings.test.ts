// 负责验证脱敏设置响应拒绝嵌套秘密与无效版本。
import { expect, it } from "vitest"
import { isSecuritySettingsView } from "./security-settings"
const summary = {
  revision: "2",
  enabled: false,
  mode: "disabled",
  siteKey: null,
  hostnames: [],
  secretConfigured: true,
  updatedAt: "2026-10-18T00:00:00Z",
  updatedBy: "admin",
}
it("only accepts a complete redacted view", () => {
  const view = { revision: "2", active: summary, draft: null }
  expect(isSecuritySettingsView(view)).toBe(true)
  expect(isSecuritySettingsView({ ...view, active: { ...summary, secretKey: "private" } })).toBe(
    false,
  )
  expect(isSecuritySettingsView({ ...view, draft: { ...summary, cipher: "private" } })).toBe(false)
  expect(isSecuritySettingsView({ ...view, revision: "9223372036854775808" })).toBe(false)
  expect(isSecuritySettingsView({ ...view, active: {} })).toBe(false)
})
