// 负责确认设置入口只按 Rust 已有权限语义开放。
import { expect, it } from "vitest"
import { canAdminPermission } from "./admin-permissions"
it.each([
  ["*", false, false],
  ["admin:*", false, false],
  ["read", false, false],
  ["settings:read", true, false],
  ["settings:write", false, true],
  ["settings:*", false, false],
  ["membership:*", false, false],
])("honors %s for settings read/write", (permission, read, write) => {
  expect(canAdminPermission([permission], "settings:read")).toBe(read)
  expect(canAdminPermission([permission], "settings:write")).toBe(write)
})
