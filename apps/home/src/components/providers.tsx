// 负责为 home 页面提供共享查询缓存和未认证会话恢复。
"use client"

import { QueryClient, QueryClientProvider, QueryCache } from "@tanstack/react-query"
import { usePathname, useRouter } from "next/navigation"
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { initTheme } from "@pigclaude/web-ui/lib/theme"
import { HomeSessionContext, type HomeSessionEndOptions } from "@/components/home-session-context"
import { beginWebOidcLogin } from "@pigclaude/api/web-oidc"
import { homeSessionGeneration } from "@/lib/session-generation"
import { homeApi } from "@/lib/api"
import {
  homeLoginRedirect,
  HOME_SESSION_REVALIDATE_EVENT,
  ME_QUERY_KEY,
  isPublicHomePath,
  requestHomeSessionRevalidation,
  retryTransientSession,
  unauthorizedQueryAction,
  type HomeSessionRevalidationEvent,
} from "@/lib/auth-query"

function currentRoute(pathname: string): string {
  if (typeof window === "undefined") return pathname
  return `${window.location.pathname}${window.location.search}`
}

/** 为 home 树提供稳定查询缓存，并把失效 session 统一恢复到登录页。 */
export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => initTheme(), [])
  const [sessionEnded, setSessionEnded] = useState(false)
  const sessionEndedRef = useRef(false)
  const router = useRouter()
  const pathname = usePathname()
  const routerRef = useRef(router)
  const pathnameRef = useRef(pathname)
  const routeGeneration = useRef(0)
  useLayoutEffect(() => {
    routeGeneration.current++
    return () => {
      routeGeneration.current++
    }
  }, [pathname])
  const sessionRecoveryRef = useRef<Promise<boolean> | null>(null)
  const recoveryHashesRef = useRef(new Set<string>())
  routerRef.current = router
  pathnameRef.current = pathname
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error, query) => {
            if (sessionEndedRef.current) return
            const currentPath = pathnameRef.current
            const action = unauthorizedQueryAction(error, query.queryKey, currentPath)
            if (action === "redirect") {
              routerRef.current.replace(homeLoginRedirect(currentRoute(currentPath)))
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
          queries: { staleTime: 30_000, retry: retryTransientSession, retryDelay: 800 },
        },
      }),
  )

  const completeLogout = useCallback(
    async (options?: HomeSessionEndOptions) => {
      homeSessionGeneration.invalidate()
      routeGeneration.current++
      const currentRouteGeneration = routeGeneration.current
      const generation = homeSessionGeneration.current()
      sessionEndedRef.current = true
      setSessionEnded(true)
      const cancellation = queryClient.cancelQueries()
      // 同步清掉本次旧会话缓存，异步等待只控制仍属当前页面的导航。
      queryClient.clear()
      recoveryHashesRef.current.clear()
      sessionRecoveryRef.current = null
      await cancellation
      if (
        generation !== homeSessionGeneration.current() ||
        currentRouteGeneration !== routeGeneration.current
      )
        return
      if (options?.switchAccountReturnTo)
        beginWebOidcLogin({ site: "home", mode: "switch", returnTo: options.switchAccountReturnTo })
      else routerRef.current.replace("/login")
    },
    [queryClient],
  )

  useEffect(() => {
    if (isPublicHomePath(pathname)) {
      sessionEndedRef.current = false
      setSessionEnded(false)
    }
  }, [pathname])

  useEffect(() => {
    function startSessionRecovery(): Promise<boolean> {
      if (sessionRecoveryRef.current) return sessionRecoveryRef.current
      const generation = homeSessionGeneration.current()
      const currentRouteGeneration = routeGeneration.current
      const ownsRecovery = () =>
        generation === homeSessionGeneration.current() &&
        currentRouteGeneration === routeGeneration.current
      const recovery = (async () => {
        try {
          await queryClient.fetchQuery({
            queryKey: ME_QUERY_KEY,
            queryFn: homeApi.user.me,
            staleTime: 0,
          })
          return ownsRecovery()
        } catch {
          if (!ownsRecovery() || sessionEndedRef.current) return false
          routerRef.current.replace(homeLoginRedirect(currentRoute(pathnameRef.current)))
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
      if (sessionEndedRef.current || isPublicHomePath(currentPath)) {
        event?.onSettled?.()
        return
      }
      const generation = homeSessionGeneration.current()
      const currentRouteGeneration = routeGeneration.current
      const isCurrent = () =>
        generation === homeSessionGeneration.current() &&
        currentRouteGeneration === routeGeneration.current
      try {
        if (!(await startSessionRecovery()) || !isCurrent() || sessionEndedRef.current) return
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

  return (
    <QueryClientProvider client={queryClient}>
      <HomeSessionContext.Provider value={{ completeLogout }}>
        {sessionEnded ? (
          <p role="status" className="query-state">
            正在退出登录…
          </p>
        ) : (
          children
        )}
      </HomeSessionContext.Provider>
    </QueryClientProvider>
  )
}
