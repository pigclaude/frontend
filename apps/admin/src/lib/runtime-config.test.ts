// 负责锁定管理后台开发代理与 Task 7 Rust server 的 loopback 默认端口。
import { describe, expect, it } from "vitest"
import { DEFAULT_RUST_API_TARGET } from "./runtime-config"

describe("admin runtime target", () => {
  it("uses the Rust server default listener", () => {
    expect(DEFAULT_RUST_API_TARGET).toBe("http://127.0.0.1:8788")
  })
})
