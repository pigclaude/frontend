// 负责迁入原后台用户列表与只读详情的布局、表格密度和交互。
import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { TableCell, TableRow } from "@/components/ui/table"

/** 表格加载骨架：宽度递减的条形，比整齐的满宽条更接近真实行的视觉节奏。 */
/** TableLoadingRows 保持用户摘要展示与可访问交互。 */
export function TableLoadingRows({ columns, rows = 5 }: { columns: number; rows?: number }) {
  return Array.from({ length: rows }).map((_, index) => (
    <TableRow key={index} className="hover:bg-transparent">
      <TableCell colSpan={columns}>
        <Skeleton className="h-4" style={{ width: `${88 - (index % 5) * 9}%` }} />
      </TableCell>
    </TableRow>
  ))
}

/** 表格空态行（整行合并单元格 + EmptyState）。 */
/** TableEmptyRow 保持用户摘要展示与可访问交互。 */
export function TableEmptyRow({
  columns,
  title,
  description,
  icon,
  action,
}: {
  columns: number
  title: ReactNode
  description?: ReactNode
  icon?: LucideIcon
  action?: ReactNode
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={columns} className="p-0">
        <EmptyState icon={icon} title={title} description={description} action={action} />
      </TableCell>
    </TableRow>
  )
}
