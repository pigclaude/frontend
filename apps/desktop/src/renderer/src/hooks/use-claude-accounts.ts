// 负责加载 Claude 账号和代理、订阅登录事件并暴露页面操作。
// 没有桌面桥时使用只读演示数据，方便在浏览器里预览页面。

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { AuthorizeClaudeAccountInput } from "../../../main/claude/account-service-inputs"
import type {
  ClaudeAccountEvent,
  ClaudeAccountView,
  ClaudeFingerprintView,
  EgressView,
  ProxyView,
} from "@pigclaude/contracts/claude-account"
import {
  createPreviewAccountsBridge,
  previewEgress,
  previewProxies,
} from "../fixtures/preview-accounts"

/** 账号和代理页面的控制器。 */
export type ClaudeAccountsController = {
  accounts: ClaudeAccountView[]
  proxies: ProxyView[]
  event: ClaudeAccountEvent | null
  error: string | null
  /** 当前是否在没有桌面桥的浏览器预览里。 */
  preview: boolean
  refresh: () => Promise<void>
  authorize: (input: AuthorizeClaudeAccountInput) => Promise<void>
  /** 返回是否完成取消及清理；保存中或清理失败时返回 false。 */
  cancelAuthorization: () => Promise<boolean>
  update: (input: {
    accountId: string
    browserProfileId?: string
    displayName?: string
    enabled?: boolean
    proxyId?: string | null
    fingerprint?: ClaudeFingerprintView
  }) => Promise<void>
  remove: (accountId: string) => Promise<void>
  /** 从 Claude CLI 导入账号；返回是否成功，成功后已刷新列表。 */
  importFromClaudeCli: (input: {
    confirmCopy: boolean
    displayName?: string
    browserProfileId?: string | undefined
  }) => Promise<boolean>
  saveProxy: (input: { id?: string; name: string; url: string }) => Promise<void>
  /** 验证并保存新代理；失败时向调用方抛错。 */
  addVerifiedProxy: (input: { name: string; url: string }) => Promise<void>
  removeProxy: (id: string) => Promise<void>
  testProxy: (id: string) => Promise<void>
  checkEgress: (id: string) => Promise<EgressView>
}

/** 订阅账号/代理数据。没有桌面桥时改用演示数据并标记 preview。 */
export function useClaudeAccounts(): ClaudeAccountsController {
  const [accounts, setAccounts] = useState<ClaudeAccountView[]>([])
  const [proxies, setProxies] = useState<ProxyView[]>([])
  const [event, setEvent] = useState<ClaudeAccountEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const authorizationRequest = useRef(0)
  const proxyRevision = useRef(0)
  const hasBridge =
    window.pigclaude?.claudeAccounts !== undefined && window.pigclaude?.proxies !== undefined
  const preview = !hasBridge
  const previewBridge = useMemo(
    () =>
      hasBridge
        ? null
        : createPreviewAccountsBridge({
            onEvent: (next) => setEvent(next),
            onAccounts: (next) => setAccounts(next),
          }),
    [hasBridge],
  )

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    const revision = proxyRevision.current
    if (previewBridge !== null) {
      setAccounts(await previewBridge.list())
      setProxies(previewProxies())
      return
    }
    const bridge = window.pigclaude
    if (!bridge?.claudeAccounts || !bridge.proxies) return
    try {
      const [nextAccounts, nextProxies] = await Promise.all([
        bridge.claudeAccounts.list(),
        bridge.proxies.list(),
      ])
      if (!mounted.current) return
      // 操作失败后紧跟的刷新不清错误；错误在下一次操作开始时清空。
      setAccounts(nextAccounts)
      if (revision === proxyRevision.current) setProxies(nextProxies)
    } catch (caught: unknown) {
      if (mounted.current) setError(errorMessage(caught))
    }
  }, [previewBridge])

  useEffect(() => {
    void refresh()
    if (previewBridge !== null) return
    const unsubscribe = window.pigclaude?.claudeAccounts?.subscribe((next) => {
      if (!mounted.current) return
      setEvent(next)
      if (
        next.phase === "authorized" ||
        next.phase === "failed" ||
        next.phase === "blocked" ||
        next.phase === "cancelled"
      ) {
        void refresh()
      }
    })
    return () => {
      unsubscribe?.()
    }
  }, [previewBridge, refresh])

  const wrap = useCallback(
    async (
      operation: () => Promise<void>,
      shouldReport: () => boolean = () => true,
    ): Promise<void> => {
      setError(null)
      try {
        await operation()
      } catch (caught: unknown) {
        if (mounted.current && shouldReport()) setError(errorMessage(caught))
      } finally {
        await refresh()
      }
    },
    [refresh],
  )

  const authorize = useCallback(
    async (input: AuthorizeClaudeAccountInput) => {
      const request = ++authorizationRequest.current
      await wrap(
        async () => {
          if (previewBridge !== null) {
            await previewBridge.authorize(input)
            return
          }
          await window.pigclaude?.claudeAccounts?.authorize(input)
        },
        () => request === authorizationRequest.current,
      )
    },
    [previewBridge, wrap],
  )

  const cancelAuthorization = useCallback(async () => {
    let cancelled = false
    await wrap(async () => {
      if (previewBridge !== null) {
        await previewBridge.cancelAuthorization()
      } else {
        await window.pigclaude?.claudeAccounts?.cancelAuthorization()
      }
      cancelled = true
      authorizationRequest.current++
    })
    return cancelled
  }, [previewBridge, wrap])

  const update = useCallback(
    async (input: {
      accountId: string
      browserProfileId?: string
      displayName?: string
      enabled?: boolean
      proxyId?: string | null
      fingerprint?: ClaudeFingerprintView
    }) => {
      await wrap(async () => {
        if (previewBridge !== null) {
          await previewBridge.update(input)
          return
        }
        await window.pigclaude?.claudeAccounts?.update(input)
      })
    },
    [previewBridge, wrap],
  )

  const remove = useCallback(
    async (accountId: string) => {
      await wrap(async () => {
        if (previewBridge !== null) {
          await previewBridge.remove(accountId)
          return
        }
        await window.pigclaude?.claudeAccounts?.remove(accountId)
      })
    },
    [previewBridge, wrap],
  )

  const importFromClaudeCli = useCallback(
    async (input: {
      confirmCopy: boolean
      displayName?: string
      browserProfileId?: string | undefined
    }): Promise<boolean> => {
      setError(null)
      try {
        if (previewBridge !== null) {
          await previewBridge.importFromClaudeCli(input)
        } else {
          const importFromClaudeCli = window.pigclaude?.claudeAccounts?.importFromClaudeCli
          if (importFromClaudeCli === undefined) throw new Error("桌面账号服务不可用")
          await importFromClaudeCli(input)
        }
        return true
      } catch (caught: unknown) {
        if (mounted.current) setError(errorMessage(caught))
        return false
      } finally {
        await refresh()
      }
    },
    [previewBridge, refresh],
  )

  const saveProxy = useCallback(
    async (input: { id?: string; name: string; url: string }) => {
      await wrap(async () => {
        if (previewBridge !== null) return
        await window.pigclaude?.proxies?.save(input)
      })
    },
    [previewBridge, wrap],
  )

  const addVerifiedProxy = useCallback(async (input: { name: string; url: string }) => {
    const saveVerified = window.pigclaude?.proxies?.saveVerified
    if (saveVerified === undefined) throw new Error("桌面代理验证服务不可用")
    proxyRevision.current++
    const saved = await saveVerified(input)
    if (mounted.current)
      setProxies((current) => [...current.filter((item) => item.id !== saved.id), saved])
  }, [])

  const removeProxy = useCallback(
    async (id: string) => {
      await wrap(async () => {
        if (previewBridge !== null) return
        await window.pigclaude?.proxies?.remove(id)
      })
    },
    [previewBridge, wrap],
  )

  const testProxy = useCallback(
    async (id: string) => {
      await wrap(async () => {
        if (previewBridge !== null) return
        await window.pigclaude?.proxies?.test(id)
      })
    },
    [previewBridge, wrap],
  )

  const checkEgress = useCallback(
    async (id: string): Promise<EgressView> => {
      if (previewBridge !== null) return previewEgress()
      try {
        const result = await window.pigclaude?.egress?.check(id)
        return result ?? { ok: false, reason: "proxy", message: "请勿登录" }
      } catch (caught: unknown) {
        if (mounted.current) setError(errorMessage(caught))
        return { ok: false, reason: "proxy", message: "请勿登录" }
      }
    },
    [previewBridge],
  )

  return {
    accounts,
    proxies,
    event,
    error,
    preview,
    refresh,
    authorize,
    cancelAuthorization,
    update,
    remove,
    importFromClaudeCli,
    saveProxy,
    addVerifiedProxy,
    removeProxy,
    testProxy,
    checkEgress,
  }
}

// Electron 把主进程错误包成「Error invoking remote method '<通道>': <类名>: <消息>」，页面只显示消息。
const remoteErrorPrefix = /^Error invoking remote method '[^']*': (?:\w*Error: )?/

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "账号操作失败"
  return error.message.replace(remoteErrorPrefix, "") || "账号操作失败"
}
