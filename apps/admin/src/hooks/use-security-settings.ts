// 负责缓存脱敏设置和审计；写入直接调用 API，秘密永不进入 mutation variables。
import { useCallback, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  SaveTurnstileDraft,
  SecuritySettingsView,
} from "@pigclaude/contracts/security-settings"
import { adminApi } from "@/lib/api"
import { useAdminMe } from "./use-admin-me"
import { securitySettingsErrorMessage } from "@/lib/security-settings-errors"
import { canAdminPermission } from "@/lib/admin-permissions"
/** 在权限门禁后加载设置，仅将验证过的服务端脱敏结果写入缓存。 */
export function useSecuritySettings() {
  const client = useQueryClient()
  const { data: me } = useAdminMe()
  const canRead =
    me?.status === "active" && canAdminPermission(me.permissions ?? [], "settings:read")
  const canWrite = canRead && canAdminPermission(me?.permissions ?? [], "settings:write")
  const query = useQuery({
    queryKey: ["security-settings"],
    queryFn: adminApi.settings.turnstile.get,
    enabled: canRead,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  })
  const [cursor, setCursor] = useState<string | undefined>()
  const history = useQuery({
    queryKey: ["security-settings-audits", cursor],
    queryFn: () => adminApi.settings.turnstile.audits({ cursor }),
    enabled: canRead,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const execute = useCallback(
    async (request: () => Promise<SecuritySettingsView>) => {
      if (pending.current || !canWrite || !query.data || query.isError || query.isFetching)
        throw new Error("请刷新配置后重试")
      pending.current = true
      setBusy(true)
      setError(null)
      try {
        const view = await request()
        client.setQueryData(["security-settings"], view)
        void client.invalidateQueries({ queryKey: ["security-settings-audits"] })
        return view
      } catch (cause) {
        setError(securitySettingsErrorMessage(cause))
        throw cause
      } finally {
        pending.current = false
        setBusy(false)
      }
    },
    [canWrite, client, query.data, query.isError, query.isFetching],
  )
  return {
    query,
    history,
    setCursor,
    canRead,
    canWrite,
    busy,
    error,
    save: (body: SaveTurnstileDraft) => execute(() => adminApi.settings.turnstile.saveDraft(body)),
    activate: (captchaToken: string) =>
      execute(() =>
        adminApi.settings.turnstile.activate({
          expectedRevision: query.data!.revision,
          captchaToken,
        }),
      ),
    disable: () =>
      execute(() =>
        adminApi.settings.turnstile.disable({
          expectedRevision: query.data!.revision,
          confirmed: true,
        }),
      ),
  }
}
