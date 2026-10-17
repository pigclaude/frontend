// 负责展示服务端管理员用户列表和 decimal string 游标分页。
import type { AdminUserItem } from "@pigclaude/api/admin/types"
import { adminApi } from "@/lib/api"
import { useCursorPager } from "@/hooks/use-cursor-pager"
import { formatTime } from "@/lib/format"
import { PageHead } from "@/components/shell/page-head"
import { Pager } from "@/components/shell/pager"
import { TableCard } from "@/components/shell/table-card"

/** 渲染用户列表，任何展示数据都来自 Admin API 的 authoritative response。 */
export default function UsersPage() {
  const pager = useCursorPager(["admin-users"], (cursor) =>
    adminApi.users.list({ cursor: cursor || undefined, limit: 20 }),
  )

  return (
    <>
      <PageHead title="用户" subtitle="查看服务端用户脱敏摘要和账号状态。" />
      <TableCard title="用户列表" description="用户数据由 Rust Admin bounded context 授权后返回。">
        {pager.isError ? (
          <div className="admin-error" role="alert">
            用户列表加载失败，请重试。
          </div>
        ) : pager.isPending && pager.items.length === 0 ? (
          <div className="admin-state">正在加载用户…</div>
        ) : pager.items.length === 0 ? (
          <div className="admin-state">暂无用户</div>
        ) : (
          <UserTable items={pager.items} />
        )}
        <Pager hasNext={pager.hasNext} isFetching={pager.isFetching} onNext={pager.goNext} />
      </TableCard>
    </>
  )
}

function UserTable({ items }: { items: AdminUserItem[] }) {
  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>账号</th>
          <th>状态</th>
          <th>余额</th>
          <th>创建时间</th>
          <th>最近登录</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td>{item.id}</td>
            <td>
              <strong>{item.nickname || "未设置昵称"}</strong>
              <div className="admin-muted">{item.email}</div>
            </td>
            <td>{item.status === "active" ? "正常" : item.status}</td>
            <td>{item.balance}</td>
            <td>{formatTime(item.createdAt)}</td>
            <td>{formatTime(item.lastLoginAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
