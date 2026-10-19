// 负责以原后台用户表格和详情抽屉展示真实用户摘要。
import { useAdminMe } from "@/hooks/use-admin-me"
import { canAdminPermission } from "@/lib/admin-permissions"
import { useState } from "react"
import type { AdminUserItem } from "@pigclaude/api/admin/types"
import { Button } from "@/components/ui/button"
import { PageHead } from "@/components/shell/page-head"
import { PagerFooter } from "@/components/shell/pager"
import { TableCard, ToolbarTitle } from "@/components/shell/table-card"
import { InlineLoadError } from "@/components/membership/table-parts"
import { UserTable } from "@/components/users/user-table"
import { UserDrawer } from "@/components/users/user-drawer"
import { adminApi } from "@/lib/api"
import { useCursorPager } from "@/hooks/use-cursor-pager"

/** 用户页只提供现有 API 支持的查询、分页和详情。 */
export default function UsersPage() {
  const { data: me, isPending } = useAdminMe()
  const [status, setStatus] = useState<"" | "active" | "banned">("")
  const [conflict, setConflict] = useState(false)
  const [detailUser, setDetailUser] = useState<AdminUserItem | null>(null)
  const pager = useCursorPager(
    ["admin-users", status],
    (cursor) => adminApi.users.list({ cursor: cursor || undefined, limit: 20, status }),
    { enabled: me?.status === "active" && canAdminPermission(me.permissions, "users:read") },
  )
  if (isPending) return <p role="status">正在读取管理员权限…</p>
  if (me?.status !== "active" || !canAdminPermission(me.permissions, "users:read"))
    return <p role="alert">缺少用户读取权限</p>
  return (
    <div className="flex flex-col gap-6">
      <PageHead title="用户" subtitle="查看用户账号摘要、状态和最近登录信息。" />
      {conflict && <p role="alert">账号状态已变化，已刷新列表，请重新选择操作。</p>}
      <TableCard
        toolbar={
          <>
            <ToolbarTitle title="用户列表" />
            <label className="flex items-center gap-2 text-sm">
              账号状态
              <select
                aria-label="账号状态"
                value={status}
                onChange={(event) => {
                  const value = event.target.value
                  setStatus(value === "active" || value === "banned" ? value : "")
                  setDetailUser(null)
                }}
                className="rounded-md border border-border bg-background p-2"
              >
                <option value="">全部</option>
                <option value="active">正常</option>
                <option value="banned">已封禁</option>
              </select>
            </label>
            <Button variant="outline" onClick={pager.retry}>
              刷新
            </Button>
          </>
        }
        footer={<PagerFooter pager={pager} noun="位用户" />}
      >
        {pager.isError && pager.items.length === 0 ? (
          <InlineLoadError message="用户列表加载失败" onRetry={pager.retry} />
        ) : (
          <UserTable items={pager.items} isPending={pager.isPending} onDetail={setDetailUser} />
        )}
      </TableCard>
      <UserDrawer
        user={detailUser}
        open={detailUser !== null}
        onUpdate={(view) =>
          setDetailUser((current) =>
            current?.id === view.userId
              ? { ...current, status: view.status, authVersion: view.authVersion }
              : current,
          )
        }
        onConflict={() => {
          setDetailUser(null)
          setConflict(true)
        }}
        onOpenChange={(open) => !open && setDetailUser(null)}
      />
    </div>
  )
}
