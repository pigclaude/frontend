// 加载可复用浏览器配置并处理产品操作，账号变更后由调用方刷新账号读取视图。

import { useCallback, useEffect, useRef, useState } from "react"
import { defaultClaudeFingerprint } from "@pigclaude/contracts/claude-account"
import type {
  BrowserProfileView,
  SaveBrowserProfileInput,
  BrowserProfileRegion,
} from "@pigclaude/contracts/browser-profile"

/** 页面与账号向导共用的实例配置控制器。 */
export type BrowserProfilesController = {
  profiles: BrowserProfileView[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  save: (input: SaveBrowserProfileInput) => Promise<void>
  remove: (id: string) => Promise<void>
  region: (proxyId: string) => Promise<BrowserProfileRegion>
}

/** 从主进程读取配置；没有桌面桥时仅提供只读预览，不用预览替代真实数据。 */
export function useBrowserProfiles(
  onChanged?: () => Promise<void>,
  ready = true,
): BrowserProfilesController {
  const [profiles, setProfiles] = useState<BrowserProfileView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const refresh = useCallback(async () => {
    if (mounted.current) setLoading(true)
    try {
      const bridge = window.pigclaude?.browserProfiles
      if (!bridge && window.pigclaude) throw new Error("浏览器配置服务不可用，请重新打开桌面应用")
      const result = bridge ? await bridge.list() : previewProfiles()
      if (mounted.current) {
        setProfiles(result)
        setError(null)
      }
    } catch (caught: unknown) {
      if (mounted.current) setError(message(caught))
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [])
  useEffect(() => {
    if (ready) {
      void refresh()
      void onChanged?.()
    }
  }, [refresh, ready, onChanged])
  const save = useCallback(
    async (input: SaveBrowserProfileInput) => {
      try {
        const bridge = window.pigclaude?.browserProfiles
        if (!bridge) throw new Error("预览环境不能保存配置")
        await bridge.save(input)
        await refresh()
        await onChanged?.()
      } catch (caught: unknown) {
        setError(message(caught))
        throw caught
      }
    },
    [onChanged, refresh],
  )
  const remove = useCallback(
    async (id: string) => {
      try {
        const bridge = window.pigclaude?.browserProfiles
        if (!bridge) throw new Error("预览环境不能删除配置")
        await bridge.remove(id)
        await refresh()
        await onChanged?.()
      } catch (caught: unknown) {
        setError(message(caught))
        throw caught
      }
    },
    [onChanged, refresh],
  )
  const region = useCallback(async (proxyId: string) => {
    const bridge = window.pigclaude?.browserProfiles
    if (!bridge) throw new Error("当前环境不能查询实际代理地区")
    return bridge.region(proxyId)
  }, [])
  return { profiles, loading, error, refresh, save, remove, region }
}

function previewProfiles(): BrowserProfileView[] {
  return [
    {
      id: "preview-us",
      name: "美国工作环境（预览）",
      proxyId: null,
      fingerprint: { ...defaultClaudeFingerprint(), lang: "en-US", timezone: "America/New_York" },
      revision: 1,
      boundAccounts: [],
      inUse: false,
      createdAt: "",
      updatedAt: "",
    },
  ]
}

function message(caught: unknown): string {
  return caught instanceof Error
    ? caught.message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "")
    : "浏览器配置操作失败"
}
