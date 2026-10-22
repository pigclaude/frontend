// 负责展示服务端等级列表和允许的管理动作。
import type { Tier } from "@pigclaude/api/membership/types"
import { formatFen } from "@pigclaude/web-ui/lib/format"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { TableCard } from "@/components/shell/table-card"
/** 列表直接展示服务端月价，不推导任何套餐金额。 */
export function TierList({
  tiers,
  canWrite,
  onEdit,
  onDelete,
}: {
  tiers: Tier[]
  canWrite: boolean
  onEdit: (tier: Tier) => void
  onDelete: (tier: Tier) => void
}) {
  return (
    <TableCard>
      <Table>
        <TableHeader>
          <TableRow>
            {["名称", "代号", "等级", "月价", "档位数", "上架状态", "操作"].map((label) => (
              <TableHead key={label}>{label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {tiers.map((tier) => (
            <TableRow key={tier.id}>
              <TableCell>{tier.name}</TableCell>
              <TableCell>{tier.code}</TableCell>
              <TableCell>{tier.level}</TableCell>
              <TableCell>{formatFen(tier.monthlyPriceFen)}</TableCell>
              <TableCell>{tier.options.length}</TableCell>
              <TableCell>{tier.enabled ? "已上架" : "已下架"}</TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  aria-label={`${canWrite ? "编辑" : "查看"} ${tier.name}`}
                  onClick={() => onEdit(tier)}
                >
                  {canWrite ? "编辑" : "查看"}
                </Button>
                {canWrite && (
                  <Button
                    variant="ghost"
                    aria-label={`删除 ${tier.name}`}
                    onClick={() => onDelete(tier)}
                  >
                    删除
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {tiers.length === 0 && <p className="p-5">暂无会员等级</p>}
    </TableCard>
  )
}
