// 负责后台写操作的页面、路由、目标及网站会话归属，旧完成不能接管新操作。
import { useCallback, useLayoutEffect, useRef, useState } from "react"
import { useLocation } from "react-router"
import { adminSessionGeneration } from "@/lib/session-generation"

/** 每次操作持有独立令牌，结束动作只能清理仍属于自己的 pending。 */
export interface AdminOperationOwner {
  /** 在每个异步阶段后检查，失效后不继续 HTTP 或修改 UI/cache。 */
  isCurrent: () => boolean
  /** 只释放当前操作，不清理后继操作的状态。 */
  finish: () => void
}

/** 挂载、路由或目标变化均撤销旧操作；begin 在第一个异步阶段前同步取得 owner。 */
export function useAdminOperationOwner(scope: string) {
  const location = useLocation()
  const [pending, setPending] = useState(false)
  const mounted = useRef(false)
  const generation = useRef(0)
  const owner = useRef<symbol | null>(null)
  useLayoutEffect(() => {
    mounted.current = true
    generation.current++
    owner.current = null
    setPending(false)
    return () => {
      mounted.current = false
      generation.current++
      owner.current = null
    }
  }, [location.key, scope])
  const begin = useCallback((): AdminOperationOwner | null => {
    if (!mounted.current || owner.current !== null) return null
    const token = Symbol()
    const current = generation.current
    const session = adminSessionGeneration.current()
    owner.current = token
    const isCurrent = () =>
      mounted.current &&
      generation.current === current &&
      owner.current === token &&
      adminSessionGeneration.current() === session
    setPending(true)
    return {
      isCurrent,
      finish: () => {
        if (!isCurrent()) return
        owner.current = null
        setPending(false)
      },
    }
  }, [])
  return { pending, begin }
}
