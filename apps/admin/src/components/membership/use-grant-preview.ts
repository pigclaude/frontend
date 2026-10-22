// 负责授予预览防抖及错误映射，旧会话和旧输入不能继续发送或更新预览。
import { useEffect, useState } from "react"
import type { GrantInput, GrantPreview } from "@pigclaude/api/membership/types"
import { ApiError } from "@pigclaude/api/client"
import { adminApi } from "@/lib/api"
import { adminSessionGeneration } from "@/lib/session-generation"
import { useAdminOperationOwner } from "@/hooks/use-admin-operation-owner"
/** 只对指定的低等级冲突提供撤销提示，其余错误保留原消息。 */
export function grantError(cause: unknown): string {
  return cause instanceof ApiError &&
    cause.status === 409 &&
    cause.code === "LOWER_TIER_WHILE_HIGHER_ACTIVE"
    ? "该用户当前是更高等级，请先撤销"
    : cause instanceof Error
      ? cause.message
      : "预览失败，请修改输入后重试"
}
/** 仅返回与完整输入标识匹配的服务端预览；等待期间失效不发请求。 */
export function useGrantPreview(input: GrantInput | null, key: string) {
  const [result, setResult] = useState<{
    key: string
    preview?: GrantPreview
    error?: string
  } | null>(null)
  const operation = useAdminOperationOwner(key)
  useEffect(() => {
    if (!input) return
    const session = adminSessionGeneration.current()
    const timer = setTimeout(() => {
      if (session !== adminSessionGeneration.current()) return
      const owner = operation.begin()
      if (!owner) return
      void adminApi.membership.grants
        .preview(input, owner.isCurrent)
        .then((preview) => {
          if (owner.isCurrent()) setResult({ key, preview })
        })
        .catch((cause: unknown) => {
          if (owner.isCurrent()) setResult({ key, error: grantError(cause) })
        })
        .finally(owner.finish)
    }, 250)
    return () => clearTimeout(timer)
  }, [input, key, operation.begin])
  return result?.key === key ? result : null
}
