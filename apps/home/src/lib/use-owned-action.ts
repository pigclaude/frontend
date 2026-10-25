// 负责个人中心写操作的并发守卫：同一时间只跑一个，页面卸载或退出登录后旧结果不再交付。
"use client"

import { useCallback, useLayoutEffect, useRef, useState } from "react"
import { homeSessionGeneration } from "@/lib/session-generation"

/** 一次写操作的回调；只有结果仍属于当前页面和当前会话时才会被调用。 */
export interface OwnedActionHandlers<T> {
  onSuccess?: (value: T) => void
  onError?: (cause: unknown) => void
}

/**
 * 返回 `run`、`pending` 和 `cancel`。`run` 在已有操作进行中时直接忽略新的调用；
 * 传给请求的 `isCurrent` 在页面卸载、调用 `cancel` 或会话代次变化后返回 false，
 * 这时成功和失败回调都不会执行。
 */
export function useOwnedAction() {
  const [pending, setPending] = useState(false)
  const generation = useRef(0)
  const owner = useRef<symbol | null>(null)
  const mounted = useRef(false)
  useLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current++
      owner.current = null
    }
  }, [])

  const run = useCallback(
    <T>(
      request: (isCurrent: () => boolean) => Promise<T>,
      handlers: OwnedActionHandlers<T> = {},
    ) => {
      if (owner.current || !mounted.current) return
      const current = generation.current
      const session = homeSessionGeneration.current()
      const token = Symbol()
      owner.current = token
      const isCurrent = () =>
        mounted.current &&
        current === generation.current &&
        token === owner.current &&
        session === homeSessionGeneration.current()
      setPending(true)
      void request(isCurrent)
        .then((value) => {
          if (isCurrent()) handlers.onSuccess?.(value)
        })
        .catch((cause: unknown) => {
          if (isCurrent()) handlers.onError?.(cause)
        })
        .finally(() => {
          if (token === owner.current) {
            owner.current = null
            if (mounted.current) setPending(false)
          }
        })
    },
    [],
  )

  const cancel = useCallback(() => {
    generation.current++
    owner.current = null
    setPending(false)
  }, [])

  return { pending, run, cancel }
}
