// 负责以原后台用户表格和详情抽屉展示真实用户摘要。
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
  const [detailUser, setDetailUser] = useState<AdminUserItem | null>(null)
  const pager = useCursorPager(["admin-users"], (cursor) =>
    adminApi.users.list({ cursor: cursor || undefined, limit: 20 }),
  )
  return (
    <div className="flex flex-col gap-6">
      <PageHead title="用户" subtitle="查看用户账号摘要、状态和最近登录信息。" />
      <TableCard
        toolbar={
          <>
            <ToolbarTitle title="用户列表" />
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
        onOpenChange={(open) => !open && setDetailUser(null)}
      />
    </div>
  )
}
