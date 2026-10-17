// 负责为 home 页面提供共享查询缓存和未认证会话恢复。
"use client"

import { QueryClient, QueryClientProvider, QueryCache } from "@tanstack/react-query"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { homeApi } from "@/lib/api"
import {
  HOME_SESSION_REVALIDATE_EVENT,
  ME_QUERY_KEY,
  isPublicHomePath,
  requestHomeSessionRevalidation,
  unauthorizedQueryAction,
  type HomeSessionRevalidationEvent,
} from "@/lib/auth-query"

/** 为 home 树提供稳定查询缓存，并把失效 session 统一恢复到登录页。 */
export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const routerRef = useRef(router)
  const pathnameRef = useRef(pathname)
  const sessionRecoveryRef = useRef<Promise<boolean> | null>(null)
  const recoveryHashesRef = useRef(new Set<string>())
  routerRef.current = router
  pathnameRef.current = pathname
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error, query) => {
            const currentPath = pathnameRef.current
            const action = unauthorizedQueryAction(error, query.queryKey, currentPath)
            if (action === "redirect") {
              routerRef.current.replace(`/login?redirect=${encodeURIComponent(currentPath)}`)
            } else if (action === "revalidate" && !recoveryHashesRef.current.has(query.queryHash)) {
              recoveryHashesRef.current.add(query.queryHash)
              const requested = requestHomeSessionRevalidation(
                query.queryHash,
                async () => {
                  await query.fetch()
                },
                () => recoveryHashesRef.current.delete(query.queryHash),
              )
              if (!requested) recoveryHashesRef.current.delete(query.queryHash)
            }
          },
        }),
        defaultOptions: {
          queries: { staleTime: 30_000, retry: false },
        },
      }),
  )

  useEffect(() => {
    function startSessionRecovery(): Promise<boolean> {
      if (sessionRecoveryRef.current) return sessionRecoveryRef.current
      const recovery = (async () => {
        try {
          await queryClient.fetchQuery({ queryKey: ME_QUERY_KEY, queryFn: homeApi.user.me })
          return true
        } catch {
          routerRef.current.replace(`/login?redirect=${encodeURIComponent(pathnameRef.current)}`)
          return false
        }
      })()
      sessionRecoveryRef.current = recovery
      void recovery.finally(() => {
        if (sessionRecoveryRef.current === recovery) sessionRecoveryRef.current = null
      })
      return recovery
    }

    async function recoverSession(event?: HomeSessionRevalidationEvent) {
      const currentPath = pathnameRef.current
      if (isPublicHomePath(currentPath)) {
        event?.onSettled?.()
        return
      }
      try {
        if (!(await startSessionRecovery())) return
        if (event?.onSessionValid) await event.onSessionValid()
        else if (!event?.queryHash) await queryClient.refetchQueries({ type: "active" })
      } catch {
        // query.fetch() 已将错误写入查询状态，交给页面的 QueryError 展示。
      } finally {
        event?.onSettled?.()
      }
    }
    function onSessionRevalidate(rawEvent: Event) {
      void recoverSession(rawEvent as HomeSessionRevalidationEvent)
    }
    window.addEventListener(HOME_SESSION_REVALIDATE_EVENT, onSessionRevalidate)
    return () => window.removeEventListener(HOME_SESSION_REVALIDATE_EVENT, onSessionRevalidate)
  }, [queryClient])

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
