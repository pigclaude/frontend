// 负责迁入成熟后台的table-parts布局和交互，使用本项目真实 API。
import type { ReactNode } from "react"
import type { MembershipStatus } from "@pigclaude/api/membership/types"
import { Badge, type BadgeVariant } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { SearchInput } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { TableCell, TableRow } from "@/components/ui/table"
import { ToolbarTitle } from "@/components/shell/table-card"

/** 复用真实游标栈的卡片分页。 */
export { PagerFooter } from "@/components/shell/pager"

const MEMBERSHIP_STATUS: Record<MembershipStatus, { label: string; tone: BadgeVariant }> = {
  none: { label: "未开通", tone: "neutral" },
  active: { label: "有效", tone: "success" },
  expired: { label: "已过期", tone: "neutral" },
  revoked: { label: "已撤销", tone: "danger" },
}

/** FilterToolbar 保持列表、表单或分页的既有交互契约。 */
export function FilterToolbar({
  title,
  userLabel = "用户 ID",
  hint,
  userInput,
  onUserInput,
  onApply,
  children,
}: {
  title: string
  userLabel?: string
  hint?: ReactNode
  userInput: string
  onUserInput: (value: string) => void
  onApply: () => void
  children?: ReactNode
}) {
  return (
    <form
      className="flex w-full flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        onApply()
      }}
    >
      <ToolbarTitle title={title} hint={hint} />
      {children}
      <SearchInput
        value={userInput}
        onChange={(event) => onUserInput(event.target.value)}

        placeholder="用户 ID"
        aria-label={userLabel}
        wrapperClassName="sm:w-[200px]!"
      />
      <Button type="submit" variant="outline">
        筛选
      </Button>
    </form>
  )
}

/** StatusBadge 保持列表、表单或分页的既有交互契约。 */
export function StatusBadge({ status }: { status: MembershipStatus }) {
  const meta = MEMBERSHIP_STATUS[status] ?? { label: status, tone: "neutral" as const }
  return (
    <Badge variant={meta.tone} dot>
      {meta.label}
    </Badge>
  )
}

/** LoadingRows 保持列表、表单或分页的既有交互契约。 */
export function LoadingRows({ columns, rows = 5 }: { columns: number; rows?: number }) {
  return Array.from({ length: rows }).map((_, index) => (
    <TableRow key={index} className="hover:bg-transparent">
      <TableCell colSpan={columns}>
        <Skeleton className="h-4" style={{ width: `${88 - index * 9}%` }} />
      </TableCell>
    </TableRow>
  ))
}

/** EmptyRow 保持列表、表单或分页的既有交互契约。 */
export function EmptyRow({ columns, message }: { columns: number; message: string }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={columns} className="p-0">
        <EmptyState title={message} />
      </TableCell>
    </TableRow>
  )
}

/** 首屏加载失败卡：不把 API 故障伪装成空记录，给页内「重试」入口。 */
/** LoadError 保持列表、表单或分页的既有交互契约。 */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-border bg-[var(--card-bg)]">
      <EmptyState
        tone="danger"
        title={message}
        description="可能是网络波动或服务暂不可用，请重试。"
        action={
          <Button size="sm" variant="outline" onClick={onRetry}>
            重试
          </Button>
        }
      />
    </div>
  )
}

/** InlineLoadError 保持列表、表单或分页的既有交互契约。 */
export function InlineLoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      role="alert"
      tone="danger"
      title={message}
      description="请稍后重试。"
      action={
        onRetry && (
          <Button variant="outline" onClick={onRetry}>
            重试
          </Button>
        )
      }
    />
  )
}

/** normalizeUserId 保持列表、表单或分页的既有交互契约。 */
export function normalizeUserId(value: string): string {
  const trimmed = value.trim()
  return trimmed
}

/** maskIdentifier 保持列表、表单或分页的既有交互契约。 */
export function maskIdentifier(value: string): string {
  if (value.length <= 12) return value
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}
