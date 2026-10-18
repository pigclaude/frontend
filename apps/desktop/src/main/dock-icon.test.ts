// 验证 Dock 图标数据地址校验：只放行体积受限的 PNG data URL，其余一律拒绝。
import { describe, expect, it } from "vitest"
import { readDockIconDataUrl } from "./dock-icon"

describe("readDockIconDataUrl", () => {
  it("合法的 PNG data URL 原样返回", () => {
    const url = "data:image/png;base64,iVBORw0KGgo="
    expect(readDockIconDataUrl(url)).toBe(url)
  })

  it("拒绝 SVG 和其他 MIME", () => {
    expect(readDockIconDataUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull()
    expect(readDockIconDataUrl("https://example.com/a.png")).toBeNull()
  })

  it("拒绝非字符串", () => {
    expect(readDockIconDataUrl(undefined)).toBeNull()
    expect(readDockIconDataUrl(42)).toBeNull()
    expect(readDockIconDataUrl({})).toBeNull()
  })

  it("拒绝超长字符串，接受恰好到上限的字符串", () => {
    const prefix = "data:image/png;base64,"
    expect(readDockIconDataUrl(prefix + "A".repeat(2_000_000))).toBeNull()
    const atLimit = prefix + "A".repeat(2_000_000 - prefix.length)
    expect(readDockIconDataUrl(atLimit)).toBe(atLimit)
  })
})
