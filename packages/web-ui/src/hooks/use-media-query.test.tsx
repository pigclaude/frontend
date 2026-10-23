// 验证媒体订阅在服务端的稳定快照和浏览器中的变化及清理。
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import { renderToString } from "react-dom/server"
import { useMediaQuery } from "./use-media-query"
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it("returns false on the server even when the browser query matches", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }))
  function Probe() {
    return <span>{String(useMediaQuery("(min-width: 800px)"))}</span>
  }
  expect(renderToString(<Probe />)).toBe("<span>false</span>")
})
it("subscribes to changes, changes query, and unsubscribes", () => {
  let matches = false
  const listeners = new Set<() => void>()
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query === "wide" && matches
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }))
  const { result, rerender, unmount } = renderHook(({ query }) => useMediaQuery(query), {
    initialProps: { query: "wide" },
  })
  expect(result.current).toBe(false)
  act(() => {
    matches = true
    listeners.forEach((listener) => listener())
  })
  expect(result.current).toBe(true)
  rerender({ query: "narrow" })
  expect(result.current).toBe(false)
  expect(listeners.size).toBe(1)
  unmount()
  expect(listeners.size).toBe(0)
})
it("returns false when matchMedia is unavailable", () => {
  vi.stubGlobal("matchMedia", undefined)
  expect(renderHook(() => useMediaQuery("wide")).result.current).toBe(false)
})
