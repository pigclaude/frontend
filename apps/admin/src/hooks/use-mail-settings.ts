// 负责邮件脱敏查询、保存和测试发信；写入归属失效后禁止更新缓存或错误状态。
import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ApiError, StaleSessionResponse } from "@pigclaude/api/client"
import type { AdminMeResponse } from "@pigclaude/api/admin/types"
import type { SaveMailSettings } from "@pigclaude/api/admin/mail-settings"
import { adminApi } from "@/lib/api"
import { useAdminMe } from "./use-admin-me"
import { useAdminOperationOwner } from "./use-admin-operation-owner"
/** 只缓存经 facade 验证的无授权码视图，秘密不进入 mutation state。 */
export function useMailSettings() {
  const client = useQueryClient()
  const { data: me } = useAdminMe()
  const canRead = me?.status === "active" && me.permissions.includes("settings:read")
  const canWrite = canRead && me.permissions.includes("settings:write")
  const key = ["mail-settings", me?.id]
  const query = useQuery({
    queryKey: key,
    queryFn: adminApi.settings.mail.view,
    enabled: canRead,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const [cursor, setCursor] = useState<string | undefined>()
  const history = useQuery({
    queryKey: ["mail-settings-audits", me?.id, cursor],
    queryFn: () => adminApi.settings.mail.audits({ cursor }),
    enabled: canRead,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const operation = useAdminOperationOwner(JSON.stringify([me?.id, canWrite, query.data?.revision]))
  const [error, setError] = useState("")
  function scopeCurrent(owner: { isCurrent: () => boolean }) {
    const current = client.getQueryData<AdminMeResponse>(["admin-me"])
    return (
      owner.isCurrent() &&
      current?.id === me?.id &&
      current?.status === "active" &&
      current.permissions.includes("settings:read") &&
      current.permissions.includes("settings:write")
    )
  }
  async function save(body: SaveMailSettings) {
    if (!canWrite || !query.data || query.isError || query.isFetching)
      throw new Error("请刷新配置后重试")
    const owner = operation.begin()
    if (!owner) throw new StaleSessionResponse()
    const isCurrent = () => scopeCurrent(owner)
    setError("")
    try {
      const view = await adminApi.settings.mail.save(body, isCurrent)
      if (!isCurrent()) throw new StaleSessionResponse()
      client.setQueryData(key, view)
      setCursor(undefined)
      void client.invalidateQueries({ queryKey: ["mail-settings-audits"] })
      return view
    } catch (cause) {
      if (!isCurrent()) throw new StaleSessionResponse()
      setError(
        cause instanceof ApiError && cause.status === 409
          ? "配置已被他人修改，请刷新"
          : "邮件设置保存失败，请检查输入后重试",
      )
      throw cause
    } finally {
      owner.finish()
    }
  }
  async function sendTest(to: string) {
    if (!canWrite || !query.data || query.isError || query.isFetching)
      throw new Error("请刷新配置后重试")
    const owner = operation.begin()
    if (!owner) throw new StaleSessionResponse()
    const isCurrent = () => scopeCurrent(owner)
    try {
      await adminApi.settings.mail.sendTest(to, isCurrent)
      if (!isCurrent()) throw new StaleSessionResponse()
    } finally {
      owner.finish()
    }
  }
  return {
    query,
    history,
    setCursor,
    canRead,
    canWrite,
    busy: operation.pending,
    error,
    save,
    sendTest,
  }
}
