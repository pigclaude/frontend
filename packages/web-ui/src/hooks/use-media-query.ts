// 订阅媒体查询变化；服务端及不支持 matchMedia 的环境返回 false。
import { useCallback, useSyncExternalStore } from "react"

/** 使用一致的服务端快照，避免水合时读取浏览器专属状态。 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {}
      const media = window.matchMedia(query)
      media.addEventListener("change", notify)
      return () => media.removeEventListener("change", notify)
    },
    [query],
  )
  const snapshot = useCallback(
    () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches,
    [query],
  )
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
