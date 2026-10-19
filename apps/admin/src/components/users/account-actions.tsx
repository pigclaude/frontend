// 负责账号封禁、解封和强制下线，使用当前权限、真实版本及唯一页面 owner。
import { useLayoutEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ApiError } from "@pigclaude/api/client"
import type { AdminUserItem } from "@pigclaude/api/admin/types"
import type { AccountModerationView } from "@pigclaude/contracts/account-status"
import { Button } from "@/components/ui/button"
import { ReasonDialog } from "../membership/reason-dialog"
import { adminApi } from "@/lib/api"
import { canAdminPermission } from "@/lib/admin-permissions"
import { accountOperationError } from "@/lib/account-errors"
import { useAdminMe } from "@/hooks/use-admin-me"
import { useAdminOperationOwner } from "@/hooks/use-admin-operation-owner"
type Action = "ban" | "unban" | "revokeSessions"
const labels = {
  ban: ["封禁账号", "确认封禁"],
  unban: ["解封账号", "确认解封"],
  revokeSessions: ["强制下线", "确认强制下线"],
}
/** 成功仅采用服务器新状态，失败和迟到返回不乐观修改账号或缓存。 */
export function AccountActions({
  user,
  onUpdate,
  onConflict,
}: {
  user: AdminUserItem
  onUpdate: (view: AccountModerationView) => void
  onConflict: () => void
}) {
  const { data: me } = useAdminMe()
  const client = useQueryClient()
  const [action, setAction] = useState<Action | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const allowed = (permission: string) =>
    me?.status === "active" && canAdminPermission(me.permissions, permission)
  const choices: Action[] = []
  if (user.status === "active" && allowed("users:ban")) choices.push("ban")
  if (user.status === "banned" && allowed("users:unban")) choices.push("unban")
  if (allowed("users:sessions:revoke")) choices.push("revokeSessions")
  const selectedAllowed = action === null || choices.includes(action)
  useLayoutEffect(() => {
    if (!selectedAllowed) setAction(null)
  }, [selectedAllowed])
  const operation = useAdminOperationOwner(
    JSON.stringify([user.id, user.authVersion, user.status, me?.id, me?.permissions, action]),
  )
  async function submit(reason: string) {
    if (!action || !choices.includes(action)) return
    const owner = operation.begin()
    if (!owner) return
    setError(null)
    setNotice(null)
    try {
      const view = await adminApi.account[action](
        user.id,
        { expectedAuthVersion: user.authVersion, reason },
        owner.isCurrent,
      )
      if (!owner.isCurrent()) return
      onUpdate(view)
      setNotice(
        action === "unban"
          ? "账号已解封，旧登录不会恢复，用户需要重新认证。"
          : action === "ban"
            ? "账号已封禁，相关登录凭据已撤销。"
            : "已强制下线，用户需要重新认证。",
      )
      setAction(null)
      void client.invalidateQueries({ queryKey: ["admin-users"] })
      void client.invalidateQueries({ queryKey: ["admin-user-devices", user.id] })
      void client.invalidateQueries({ queryKey: ["admin-audits"] })
    } catch (cause) {
      if (!owner.isCurrent()) return
      setError(accountOperationError(cause))
      if (cause instanceof ApiError && cause.status === 409) {
        void client.invalidateQueries({ queryKey: ["admin-users"] })
        onConflict()
      }
    } finally {
      owner.finish()
    }
  }
  return (
    <section className="flex min-w-0 flex-col gap-3">
      {notice && <p role="status">{notice}</p>}
      {error && !action && <p role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {choices.map((item) => (
          <Button
            key={item}
            variant="outline"
            disabled={operation.pending}
            onClick={() => {
              setAction(item)
              setError(null)
              setNotice(null)
            }}
          >
            {labels[item][0]}
          </Button>
        ))}
      </div>
      <ReasonDialog
        error={error}
        open={action !== null}
        title={action ? labels[action][0] : "账号操作"}
        description={
          action === "unban"
            ? "解封不会恢复旧登录、旧令牌或旧授权。用户需要重新认证。"
            : "确认后将撤销该账号现有登录凭据，不改变会员或共享硬件上其他账号。"
        }
        reasonLabel="操作原因"
        confirmLabel={action ? labels[action][1] : "确认"}
        preserveWhitespace
        maxCharacters={500}
        pending={operation.pending}
        onOpenChange={(open) => {
          if (!open) setAction(null)
        }}
        onConfirm={(reason) => void submit(reason)}
      />
    </section>
  )
}
