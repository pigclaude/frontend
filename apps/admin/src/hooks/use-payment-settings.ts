// 负责支付脱敏查询和直接保存命令；写入归属失效后禁止更新缓存或错误状态。
import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ApiError, StaleSessionResponse } from "@pigclaude/api/client"
import type { AdminMeResponse } from "@pigclaude/api/admin/types"
import type { SavePaymentSettings } from "@pigclaude/api/membership/payment-settings"
import { adminApi } from "@/lib/api"
import { useAdminMe } from "./use-admin-me"
import { useAdminOperationOwner } from "./use-admin-operation-owner"
/** 只缓存经 facade 验证的无密钥视图，秘密不进入 mutation state。 */
export function usePaymentSettings() {
  const client = useQueryClient()
  const { data: me } = useAdminMe()
  const canRead = me?.status === "active" && me.permissions.includes("payment:read")
  const canWrite = canRead && me.permissions.includes("payment:settings:write")
  const key = ["payment-settings", me?.id]
  const query = useQuery({
    queryKey: key,
    queryFn: adminApi.settings.payment.view,
    enabled: canRead,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const [cursor, setCursor] = useState<string | undefined>()
  const history = useQuery({
    queryKey: ["payment-settings-audits", me?.id, cursor],
    queryFn: () => adminApi.settings.payment.audits({ cursor }),
    enabled: canRead,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const operation = useAdminOperationOwner(JSON.stringify([me?.id, canWrite, query.data?.revision]))
  const [error, setError] = useState("")
  async function save(body: SavePaymentSettings) {
    if (!canWrite || !query.data || query.isError || query.isFetching)
      throw new Error("请刷新配置后重试")
    const owner = operation.begin()
    if (!owner) throw new StaleSessionResponse()
    const isCurrent = () => {
      const current = client.getQueryData<AdminMeResponse>(["admin-me"])
      return (
        owner.isCurrent() &&
        current?.id === me?.id &&
        current?.status === "active" &&
        current.permissions.includes("payment:read") &&
        current.permissions.includes("payment:settings:write")
      )
    }
    setError("")
    try {
      const view = await adminApi.settings.payment.save(body, isCurrent)
      if (!isCurrent()) throw new StaleSessionResponse()
      client.setQueryData(key, view)
      setCursor(undefined)
      void client.invalidateQueries({ queryKey: ["payment-settings-audits"] })
      return view
    } catch (cause) {
      if (!isCurrent()) throw new StaleSessionResponse()
      setError(
        cause instanceof ApiError && cause.status === 409
          ? "配置已被他人修改，请刷新"
          : "支付设置保存失败，请检查输入后重试",
      )
      throw cause
    } finally {
      owner.finish()
    }
  }
  return { query, history, setCursor, canRead, canWrite, busy: operation.pending, error, save }
}
