// 负责迁入成熟后台的members-section布局和交互，使用本项目真实 API。
import { GrantDialog } from "./grant-dialog"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { MembershipItem, MembershipStatus } from "@pigclaude/api/membership/types"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatTime } from "@/lib/format"
import { TableCard } from "@/components/shell/table-card"
import { useCursorPager } from "@/hooks/use-cursor-pager"
import { adminApi } from "@/lib/api"
import { useAdminOperationOwner } from "@/hooks/use-admin-operation-owner"
import { toastApiError } from "@/lib/errors"
import { ReasonDialog } from "./reason-dialog"
import {
  EmptyRow,
  FilterToolbar,
  InlineLoadError,
  LoadingRows,
  PagerFooter,
  StatusBadge,
  normalizeUserId,
} from "./table-parts"

// 会员列表：合并后一个用户一条会员记录。可按用户 ID / 状态筛选；
// 行内「撤销」是安全停权（ReasonDialog 收必填原因，写不可变审计）。
/** MembersSection 保持列表、表单或分页的既有交互契约。 */
export function MembersSection() {
  const [showGrant, setShowGrant] = useState(false)
  const queryClient = useQueryClient()
  const [userInput, setUserInput] = useState("")
  const [userId, setUserId] = useState("")
  const [status, setStatus] = useState<MembershipStatus | "">("")
  const [revokeTarget, setRevokeTarget] = useState<MembershipItem | null>(null)
  const pager = useCursorPager(["admin-memberships", userId, status], (cursor) =>
    adminApi.membership.memberships
      .list({
        q: userId || undefined,
        status,
        cursor: cursor === "0" ? undefined : cursor,
        limit: 20,
      })
      .then((page) => ({ ...page, nextCursor: page.nextCursor ?? "0" })),
  )
  const revokeOperation = useAdminOperationOwner(
    JSON.stringify([userId, status, revokeTarget?.userId, revokeTarget?.entitlementVersion]),
  )
  async function revoke(reason: string) {
    if (!revokeTarget) return
    const owner = revokeOperation.begin()
    if (!owner) return
    const targetUserId = revokeTarget.userId
    try {
      const membership = await adminApi.membership.revoke(
        { userId: targetUserId, reason },
        owner.isCurrent,
      )
      if (!owner.isCurrent()) return
      void queryClient.invalidateQueries({ queryKey: ["admin-memberships"] })
      void queryClient.invalidateQueries({ queryKey: ["admin-audits"] })
      toast.success(`已撤销用户 ${targetUserId} 的会员`)
      pager.reset()
      window.dispatchEvent(new CustomEvent("pigclaude:admin-membership", { detail: membership }))
      setRevokeTarget(null)
    } catch (error) {
      if (owner.isCurrent()) toastApiError(error)
    } finally {
      owner.finish()
    }
  }

  return (
    <>
      {showGrant && (
        <GrantDialog open={showGrant} onOpenChange={setShowGrant} onGranted={pager.reset} />
      )}
      <TableCardContent
        pager={pager}
        userInput={userInput}
        status={status}
        onUserInput={setUserInput}
        onApply={() => setUserId(normalizeUserId(userInput))}
        onStatus={setStatus}
        onRevoke={setRevokeTarget}
        onGrant={() => setShowGrant(true)}
      />
      <ReasonDialog
        open={revokeTarget !== null}
        title={`撤销用户 ${revokeTarget?.userId ?? ""} 的会员`}
        description={`撤销用户 ${revokeTarget?.userId ?? ""} 的会员后，该用户将无法继续使用会员权限。请填写撤销原因。`}
        confirmLabel="确认"
        pending={revokeOperation.pending}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        onConfirm={(reason) => void revoke(reason)}
      />
    </>
  )
}

/** TableCardContent 保持列表、表单或分页的既有交互契约。 */
function TableCardContent({
  pager,
  userInput,
  status,
  onUserInput,
  onApply,
  onStatus,
  onRevoke,
  onGrant,
}: {
  pager: ReturnType<typeof useCursorPager<MembershipItem>>
  userInput: string
  status: MembershipStatus | ""
  onUserInput: (value: string) => void
  onApply: () => void
  onStatus: (value: MembershipStatus | "") => void
  onRevoke: (item: MembershipItem) => void
  onGrant: () => void
}) {
  return (
    <TableCard
      toolbar={
        <FilterToolbar
          title="会员列表"
          userLabel="会员用户筛选"
          userInput={userInput}
          onUserInput={onUserInput}
          onApply={onApply}
        >
          <Select
            value={status || "all"}
            onValueChange={(value) => onStatus(value === "all" ? "" : (value as MembershipStatus))}
          >
            <SelectTrigger aria-label="会员状态">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="active">有效</SelectItem>
              <SelectItem value="expired">已过期</SelectItem>
              <SelectItem value="revoked">已撤销</SelectItem>
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" onClick={onGrant}>
            人工授予
          </Button>
        </FilterToolbar>
      }
      footer={<PagerFooter pager={pager} noun="条会员" />}
    >
      {pager.isError && pager.items.length === 0 ? (
        <InlineLoadError message="会员列表加载失败" onRetry={pager.retry} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>用户</TableHead>
              <TableHead>档位</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>授权期限</TableHead>
              <TableHead>权益版本</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pager.isPending ? (
              <LoadingRows columns={6} />
            ) : pager.items.length === 0 ? (
              <EmptyRow columns={6} message="暂无会员记录" />
            ) : (
              pager.items.map((item) => (
                <MembershipRow
                  key={`${item.userId}-${item.entitlementVersion}`}
                  item={item}
                  onRevoke={onRevoke}
                />
              ))
            )}
          </TableBody>
        </Table>
      )}
    </TableCard>
  )
}

/** MembershipRow 保持列表、表单或分页的既有交互契约。 */
function MembershipRow({
  item,
  onRevoke,
}: {
  item: MembershipItem
  onRevoke: (item: MembershipItem) => void
}) {
  return (
    <TableRow>
      <TableCell className="font-mono text-foreground">{item.userId}</TableCell>
      <TableCell>
        <p className="font-mono text-xs text-foreground">{item.tier.name}</p>
        <p className="text-xs text-meta">{item.tier.code}</p>
      </TableCell>
      <TableCell>
        <StatusBadge status={item.status} />
      </TableCell>
      <TableCell>{formatTime(item.validUntil)}</TableCell>
      <TableCell>
        <p className="mt-0.5 text-xs text-meta">版本 {item.entitlementVersion}</p>
      </TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          variant="danger"
          disabled={item.status === "revoked"}
          onClick={() => onRevoke(item)}
        >
          撤销
        </Button>
      </TableCell>
    </TableRow>
  )
}
