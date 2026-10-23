// 为每条媒体查询维护独立订阅，并在服务端提供固定的 false 快照。
import { useCallback, useMemo, useSyncExternalStore } from "react"

/** 读取当前媒体匹配状态；查询变化时更换订阅，卸载时移除监听。 */
export function useMediaQuery(query: string): boolean {
  const media = useMemo(
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query) : null),
    [query],
  )
  const subscribe = useCallback(
    (notify: () => void) => {
      media?.addEventListener("change", notify)
      return () => media?.removeEventListener("change", notify)
    },
    [media],
  )
  const read = useCallback(() => media?.matches ?? false, [media])
  return useSyncExternalStore(subscribe, read, () => false)
}
