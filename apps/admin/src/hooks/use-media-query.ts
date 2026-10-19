// 负责迁入 Pigcursor 成熟后台的use-media-query组件与交互，保持原有布局和语义。
import { useCallback, useSyncExternalStore } from "react"

/** 订阅 CSS 媒体查询；SSR/测试环境无 matchMedia 时恒为 false。 */
/** useMediaQuery 保持后台组件的样式、可访问语义和交互契约。 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () =>
      typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false,
    () => false,
  )
}
