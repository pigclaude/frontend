// 负责统一第一阶段后台列表的 decimal string cursor 分页、加载和失败状态。
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

interface CursorPage<T> {
  items: T[]
  nextCursor: string
}

/** 管理游标列表的当前 cursor，并在 filter key 改变时回到第一页。 */
export function useCursorPager<T>(
  queryKey: readonly unknown[],
  queryPage: (cursor: string) => Promise<CursorPage<T>>,
) {
  const [cursor, setCursor] = useState("0")
  const query = useQuery({
    queryKey: [...queryKey, cursor],
    queryFn: () => queryPage(cursor === "0" ? "" : cursor),
    retry: false,
    placeholderData: (previous) => previous,
  })

  return {
    ...query,
    cursor,
    nextCursor: query.data?.nextCursor ?? "0",
    items: query.data?.items ?? [],
    hasNext: (query.data?.nextCursor ?? "0") !== "0",
    goNext: () => {
      if (query.data?.nextCursor && query.data.nextCursor !== "0") setCursor(query.data.nextCursor)
    },
    reset: () => setCursor("0"),
  }
}
