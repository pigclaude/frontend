// 负责验证主题色持久化、缓存一致性、首帧恢复及受限存储回退。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyAccent, readAccent, resetAccent, subscribeAccent, ACCENT_STORAGE_KEY } from "./accent"
const fallback = { kind: "preset", id: "indigo" }
beforeEach(() => {
  localStorage.clear()
  document.getElementById("pigclaude-accent")?.remove()
})
afterEach(() => vi.restoreAllMocks())

describe("accent persistence", () => {
  it("apply stores versioned choice and injects style", () => {
    applyAccent({ kind: "preset", id: "rose" })
    expect(JSON.parse(localStorage.getItem(ACCENT_STORAGE_KEY)!)).toMatchObject({
      v: 1,
      choice: { kind: "preset", id: "rose" },
    })
    expect(document.getElementById("pigclaude-accent")?.textContent).toContain("html:root")
    applyAccent({ kind: "preset", id: "blue" })
    expect(document.querySelectorAll("#pigclaude-accent")).toHaveLength(1)
  })
  it("read falls back to indigo on garbage", () => {
    for (const raw of [
      "{oops",
      JSON.stringify({ v: 0 }),
      JSON.stringify({ v: 1, choice: { kind: "custom", hex: "red" } }),
    ]) {
      localStorage.setItem(ACCENT_STORAGE_KEY, raw)
      expect(readAccent()).toEqual(fallback)
    }
  })
  it("denied storage still applies the current color without throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied")
    })
    expect(readAccent()).toEqual(fallback)
    expect(() => applyAccent({ kind: "custom", hex: "#12ab34" })).not.toThrow()
    expect(document.getElementById("pigclaude-accent")?.textContent).toContain("html:root")
  })
  it("cross-page storage events synchronize style and release listeners", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeAccent(listener)
    applyAccent({ kind: "preset", id: "rose" })
    const raw = localStorage.getItem(ACCENT_STORAGE_KEY)!
    resetAccent()
    listener.mockClear()
    localStorage.setItem(ACCENT_STORAGE_KEY, raw)
    window.dispatchEvent(new StorageEvent("storage", { key: ACCENT_STORAGE_KEY }))
    expect(readAccent()).toEqual({ kind: "preset", id: "rose" })
    expect(document.getElementById("pigclaude-accent")?.textContent).toContain("html:root")
    localStorage.setItem(ACCENT_STORAGE_KEY, "{oops")
    window.dispatchEvent(new StorageEvent("storage", { key: ACCENT_STORAGE_KEY }))
    expect(readAccent()).toEqual(fallback)
    expect(document.getElementById("pigclaude-accent")).toBeNull()
    unsubscribe()
    listener.mockClear()
    window.dispatchEvent(new StorageEvent("storage", { key: ACCENT_STORAGE_KEY }))
    expect(listener).not.toHaveBeenCalled()
  })
  it("reset removes storage and style", () => {
    applyAccent({ kind: "preset", id: "rose" })
    resetAccent()
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBeNull()
    expect(document.getElementById("pigclaude-accent")).toBeNull()
    expect(readAccent()).toEqual(fallback)
  })
})
