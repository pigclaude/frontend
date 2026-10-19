// 负责迁入成熟后台的use-cursor-pager布局和交互，使用本项目真实 API。
import { useCallback, useState } from "react"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"

/** 服务端游标页结构。 */
export interface CursorPage<T> {
  items: T[]
  nextCursor: string
}

/** 查询门控选项。 */
export interface UseCursorPagerOptions {
  /** false = 门控：不发查询（fetchPage 不调用，items 为空）。用于依赖上级数据（如师傅行 ID）的列表。 */
  enabled?: boolean
}

/**
 * 首屏失败判定（评审 R11 F3 / R25 F1 / R36 F1）：**初始游标**（pageIndex 0）失败且
 * **无缓存数据**（hasData=false） = 首屏失败——调用方渲染全量错误/重试卡，不得把 API
 * 故障伪装成空记录（AGENTS.md L119）。首屏已成功加载（hasData：该游标键已有缓存页）后
 * 窗口聚焦等后台 refetch 失败——TanStack Query 保留 data 且 isError 置位——**不视为
 * 首屏失败**：继续渲染缓存表格（行可见），错误仅由调用方 toast、重试仍可用（评审 R36
 * F1，同 home `overviewDataView` R34 F1 口径：有数据不阻塞，仅无数据才阻塞）。
 * 后续游标页失败（页栈已有缓存页、Previous 可用）同样**不视为首屏失败**：替换成重试卡
 * 会丢掉表格与页脚、只能重取失败游标而无法返回已缓存页（评审 R25 F1）。
 */
/** pagerFirstLoadError 保持列表、表单或分页的既有交互契约。 */
export function pagerFirstLoadError(
  isError: boolean,
  pageIndex: number,
  hasData: boolean,
): boolean {
  return isError && pageIndex === 0 && !hasData
}

/** 翻页失败判定（评审 R25 F1）：非初始游标失败 = 本页加载失败——表格与页脚保留，
 *  页脚显示「本页加载失败，可返回上一页或重试」提示。 */
/** pagerLoadMoreError 保持列表、表单或分页的既有交互契约。 */
export function pagerLoadMoreError(isError: boolean, pageIndex: number): boolean {
  return isError && pageIndex > 0
}

/**
 * 缓存首屏 refetch 失败判定（评审 R53 F3，镜像 home R41 F1 infiniteListErrorView 的
 * refetch 态）：初始游标（pageIndex 0）失败但**已有缓存数据**（hasData=true）——既非
 * 首屏失败（pagerFirstLoadError 要求 !hasData）也非翻页失败（pagerLoadMoreError 要求
 * pageIndex>0），此前该态只有瞬态 toast、页内无恢复入口。置位时调用方在缓存表格旁
 * 渲染「刷新失败 + 重试」提示（重试 pager.retry——refetch 当前游标键，即首页重取），
 * 缓存行保留不卸载。
 */
/** pagerRefetchError 保持列表、表单或分页的既有交互契约。 */
export function pagerRefetchError(isError: boolean, pageIndex: number, hasData: boolean): boolean {
  return isError && pageIndex === 0 && hasData
}

/** 分页器错误是否应 toast（评审 R12 F3）：只要 error 就 toast error.message——首屏失败
 *  （重试卡不展示具体错误）与翻页失败都不静默（AGENTS.md L119 message 供 toast 展示）。 */
/** shouldToastPagerError 保持列表、表单或分页的既有交互契约。 */
export function shouldToastPagerError(isError: boolean): boolean {
  return isError
}

/**
 * 通用游标翻页：cursor 栈实现「上一页/下一页」。users/recharge/sms 三个列表页共用。
 *
 * 契约（对照 apps/home `panel-bills.tsx` 的 useInfiniteQuery 同一约定）：
 * `'0'` 为起始游标；`fetchPage` 返回的 `nextCursor === '0'` 表示无下一页。
 * 服务端不返回总数，`page` 仅表示当前第几页，UI 展示形如「{page} / …」。
 *
 * `queryKeyBase` 变化（如筛选关键词变了）时，hook 在渲染内同步复位 cursor 栈到起始页，
 * 故调用方无需再自行 `reset()`（`reset()` 仍导出，供「清空筛选」等手动复位场景）。
 */
export function useCursorPager<T>(
  queryKeyBase: unknown[],
  fetchPage: (cursor: string) => Promise<CursorPage<T>>,
  options?: UseCursorPagerOptions,
) {
  const [cursors, setCursors] = useState<string[]>(["0"])
  const [pageIndex, setPageIndex] = useState(0)
  const queryClient = useQueryClient()

  // queryKeyBase 变化（筛选/搜索变了）时在渲染内**同步**复位游标栈（React「渲染中重置派生 state」惯例）。
  const baseKey = JSON.stringify(queryKeyBase)
  const [prevBaseKey, setPrevBaseKey] = useState(baseKey)
  const baseChanged = baseKey !== prevBaseKey
  if (baseChanged) {
    setPrevBaseKey(baseKey)
    setCursors(["0"])
    setPageIndex(0)
  }

  // 关键：baseChanged 的这一渲染里 cursors/pageIndex 尚未更新（setState 只排期重渲染），
  // 若直接 `cursors[pageIndex]` 会派生上一筛选积累的旧游标。显式取 '0' 让本次渲染的 queryKey
  // 立即是 [新 base, '0']——既不会用旧游标经 getOptimisticResult 建出幽灵 query 缓存项，
  // 也不必依赖「React 丢弃本次渲染重试 + RQ 副作用延迟取数」的时序,新筛选恒以起始游标请求。
  const cursor = baseChanged ? "0" : (cursors[pageIndex] ?? "0")

  const enabled = options?.enabled ?? true

  const { data, isPending, isError, error, isPlaceholderData } = useQuery({
    queryKey: [...queryKeyBase, cursor],
    queryFn: () => fetchPage(cursor === "0" ? "" : cursor),
    // 门控（enabled=false）期间禁用 keepPreviousData：依赖上级数据（如师傅行 ID）的列表
    // 在 key 变化/上级未就绪时不得显示上一个主体的旧行（评审 R3 F2），重新启用后恢复占位。
    placeholderData: enabled ? keepPreviousData : undefined,
    enabled,
    retry: false,
  })

  // keepPreviousData 期间 data 还是上一页的（nextCursor 也是），此时放行 next()
  // 会把同一游标重复压栈、页码跳号——占位期间视为「无下一页」，翻页钮随之禁用。
  const hasNext = enabled && !!data && !isPlaceholderData && data.nextCursor !== "0"
  const hasPrev = pageIndex > 0

  function next() {
    if (!data || isPlaceholderData || data.nextCursor === "0") return
    const nextIndex = pageIndex + 1
    const nextCursor = data.nextCursor
    setCursors((cs) => (nextIndex < cs.length ? cs : [...cs, nextCursor]))
    setPageIndex(nextIndex)
  }

  function prev() {
    setPageIndex((i) => Math.max(0, i - 1))
  }

  // 当前游标重试（评审 R27 F2）：后续页失败时该游标无 data（hasNext=false、Next 禁用），
  // Previous 是唯一可用路径——显式重试**同一失败游标**，成功后即可继续翻页。
  // 页脚「本页加载失败」提示与重试按钮即调用此动作（queryClient.refetchQueries 命中
  // 当前游标键的 error 缓存查询）。
  function retry() {
    void queryClient.refetchQueries({ queryKey: [...queryKeyBase, cursor], exact: true })
  }

  // 稳定引用（空依赖）：可安全放进调用方 useEffect 的依赖数组而不引发额外重跑。
  const reset = useCallback(() => {
    setCursors(["0"])
    setPageIndex(0)
  }, [])

  // 门控期间恒返回空 items：即使同键缓存有数据（或 keepPreviousData 占位），
  // 禁用中也不渲染旧行（评审 R3 F2）。
  const items = enabled ? (data?.items ?? []) : []

  // 首屏失败（评审 R11 F3 / R36 F1）：初始游标失败且**无缓存数据** = 请求失败而非
  // 「权威空历史」——调用方应渲染错误/重试态，不得把 API 故障伪装成空记录（AGENTS.md L119）。
  // 评审 R36 F1：首屏已加载成功后后台 refetch 失败（TanStack Query 保留 data、isError
  // 置位）不再视为首屏失败——继续渲染缓存表格，错误仅由调用方 toast（shouldToastPagerError
  // 不变）、重试仍可用；阻塞只看是否已有缓存数据（同 home R34 F1 overviewDataView 口径）。
  // 评审 R25 F1：后续游标页失败 ≠ 首屏失败——保留表格与页脚（Previous 返回缓存页），
  // 页脚只显示本页加载失败提示。
  const firstLoadError = pagerFirstLoadError(isError, pageIndex, !!data)
  const loadMoreError = pagerLoadMoreError(isError, pageIndex)
  // 评审 R53 F3：缓存首屏的后台 refetch 失败单独成态——既不阻塞（有数据）也不归为
  // 翻页失败；调用方在缓存表格旁渲染刷新失败重试入口（此前该失败态只有 toast）。
  const refetchError = pagerRefetchError(isError, pageIndex, !!data)

  return {
    cursor,
    items,
    isPending,
    isError,
    error,
    firstLoadError,
    loadMoreError,
    refetchError,
    page: pageIndex + 1,
    hasPrev,
    hasNext,
    next,
    goNext: next,
    prev,
    retry,
    reset,
  }
}
