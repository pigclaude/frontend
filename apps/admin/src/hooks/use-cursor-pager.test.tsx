// 负责验证成熟游标栈迁入后的回退、筛选复位和失败恢复。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { useCursorPager } from "./use-cursor-pager"

function setup(fetchPage: (cursor: string) => Promise<{ items: string[]; nextCursor: string }>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(({ filter }) => useCursorPager(["test", filter], fetchPage), {
    wrapper,
    initialProps: { filter: "all" },
  })
}

describe("useCursorPager", () => {
  it("returns to a known previous cursor and resets new filters to the first page", async () => {
    const fetchPage = vi.fn(async (cursor: string) => ({
      items: [cursor],
      nextCursor: cursor === "9" ? "0" : "9",
    }))
    const hook = setup(fetchPage)
    await waitFor(() => expect(hook.result.current.hasNext).toBe(true))
    act(() => hook.result.current.next())
    await waitFor(() => expect(hook.result.current.items).toEqual(["9"]))
    act(() => hook.result.current.prev())
    await waitFor(() => expect(hook.result.current.page).toBe(1))
    act(() => hook.result.current.next())
    await waitFor(() => expect(hook.result.current.page).toBe(2))
    hook.rerender({ filter: "active" })
    await waitFor(() => expect(hook.result.current.page).toBe(1))
    expect(hook.result.current.cursor).toBe("0")
  })
})
