// 负责锁定管理后台开发代理与 Task 7 Rust server 的 loopback 默认端口。
import { describe, expect, it } from "vitest"
import { DEFAULT_RUST_API_TARGET, DEFAULT_HOME_ORIGIN, resolveHomeOrigin } from "./runtime-config"

describe("admin runtime target", () => {
  it("uses the Rust server default listener", () => {
    expect(DEFAULT_RUST_API_TARGET).toBe("http://127.0.0.1:8788")
  })
})

describe("public home origin", () => {
  it("uses only the configured HTTP(S) origin", () => {
    expect(resolveHomeOrigin("http://127.0.0.1:65534/path?token=public")).toBe(
      "http://127.0.0.1:65534",
    )
    expect(resolveHomeOrigin("https://home.example.test/account")).toBe("https://home.example.test")
  })
  it("falls back for credentials, unsupported protocols and malformed values", () => {
    for (const value of [
      undefined,
      "",
      "/",
      "javascript:alert(1)",
      "file:///tmp/home",
      "https://name:password@home.example.test",
    ]) {
      expect(resolveHomeOrigin(value)).toBe(DEFAULT_HOME_ORIGIN)
    }
  })
})
