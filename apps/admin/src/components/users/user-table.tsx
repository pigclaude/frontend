// 负责迁入原后台用户列表与只读详情的布局、表格密度和交互。
import { SearchX } from "lucide-react"
import type { AdminUserItem } from "@pigclaude/api/admin/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TableEmptyRow, TableLoadingRows } from "@/components/shell/table-states"

interface UserTableProps {
  items: AdminUserItem[]
  isPending: boolean
  onDetail: (u: AdminUserItem) => void
}

// UID/头像+昵称+邮箱/GitHub/余额/状态 pill/操作 六列，对照
// `$PROTO/admin-users.html` `#users-table` + 内联 `.u-cell`/`.row-actions` 样式。
/** UserTable 保持用户摘要展示与可访问交互。 */
export function UserTable({ items, isPending, onDetail }: UserTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>UID</TableHead>
          <TableHead>用户</TableHead>
          <TableHead>GitHub</TableHead>
          <TableHead className="text-right">余额</TableHead>
          <TableHead>状态</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isPending ? (
          <TableLoadingRows columns={6} rows={6} />
        ) : items.length === 0 ? (
          <TableEmptyRow
            columns={6}
            icon={SearchX}
            title="暂无用户"
            description="稍后点击刷新，查看最新用户列表。"
          />
        ) : (
          items.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="font-mono text-xs text-muted-foreground">{u.id}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2.5">
                  {u.avatar ? (
                    <img
                      src={u.avatar}
                      alt=""
                      className="size-8 shrink-0 rounded-full border border-border object-cover"
                    />
                  ) : (
                    <span className="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-raise-3 text-xs font-semibold text-foreground">
                      {u.nickname.slice(0, 1)}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{u.nickname}</span>
                    <span className="block truncate text-xs text-meta">{u.email}</span>
                  </span>
                </div>
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {u.githubLogin ? `@${u.githubLogin}` : "—"}
              </TableCell>
              <TableCell className="text-right font-mono text-foreground tabular-nums">
                {u.balance}
              </TableCell>
              <TableCell>
                {u.status === "active" ? (
                  <Badge variant="success" dot>
                    正常
                  </Badge>
                ) : (
                  <Badge variant="danger" dot>
                    已封禁
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => onDetail(u)}>
                    详情
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}
