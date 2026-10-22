// 负责会员等级权限、列表、编辑抽屉及删除确认。
import { useState } from "react"
import { useLocation } from "react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { Tier } from "@pigclaude/api/membership/types"
import { ApiError } from "@pigclaude/api/client"
import { adminApi } from "@/lib/api"
import { useAdminMe } from "@/hooks/use-admin-me"
import { useAdminOperationOwner } from "@/hooks/use-admin-operation-owner"
import { tierPermissions } from "@/lib/admin-permissions"
import { PageHead } from "@/components/shell/page-head"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { TierList } from "@/components/tiers/tier-list"
import { TierEditor } from "@/components/tiers/tier-editor"
/** 只读管理员只能查看；预览和写入必须拥有显式等级写权限。 */
export default function TiersPage() {
  const { data: me } = useAdminMe()
  const { canRead, canWrite } = tierPermissions(me)
  const location = useLocation()
  const identity = JSON.stringify([me?.id, location.key])
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ["admin-tiers", me?.id],
    queryFn: adminApi.membership.tiers.list,
    enabled: canRead,
    retry: false,
  })
  const [editing, setEditing] = useState<{ tier: Tier | null; identity: string } | null>(null)
  const [deleting, setDeleting] = useState<{ tier: Tier; identity: string } | null>(null)
  const [error, setError] = useState("")
  const operation = useAdminOperationOwner(JSON.stringify([identity, canWrite, deleting?.tier.id]))
  async function remove() {
    if (!canWrite || !deleting || deleting.identity !== identity) return
    const owner = operation.begin()
    if (!owner) return
    setError("")
    try {
      await adminApi.membership.tiers.remove(deleting.tier.id, owner.isCurrent)
      if (!owner.isCurrent()) return
      for (const queryKey of [
        ["admin-tiers"],
        ["admin-memberships"],
        ["admin-audits"],
        ["membership-catalog"],
      ])
        void client.invalidateQueries({ queryKey })
      window.dispatchEvent(new CustomEvent("pigclaude:admin-membership"))
      setDeleting(null)
    } catch (cause) {
      if (owner.isCurrent())
        setError(
          cause instanceof ApiError && cause.status === 409 && cause.code === "INVALID_STATE"
            ? "还有有效会员，请改为下架"
            : cause instanceof Error
              ? cause.message
              : "删除失败",
        )
    } finally {
      owner.finish()
    }
  }
  if (!canRead) return <p>没有查看会员等级的权限</p>
  return (
    <div className="flex flex-col gap-6">
      <PageHead
        title="会员等级"
        subtitle="管理等级与价格。1 个月按 30 天计。"
        actions={
          canWrite && <Button onClick={() => setEditing({ tier: null, identity })}>新建等级</Button>
        }
      />
      {query.isPending && <p>加载中…</p>}
      {query.isError && (
        <div role="alert">
          加载失败<Button onClick={() => void query.refetch()}>重试</Button>
        </div>
      )}
      {query.data && (
        <TierList
          tiers={query.data.items}
          canWrite={canWrite}
          onEdit={(tier) => setEditing({ tier, identity })}
          onDelete={(tier) => {
            setError("")
            setDeleting({ tier, identity })
          }}
        />
      )}
      {editing?.identity === identity && (
        <TierEditor
          key={`${identity}-${editing.tier?.id ?? "new"}`}
          tier={editing.tier}
          identity={identity}
          canWrite={canWrite}
          onClose={() => setEditing(null)}
        />
      )}
      <Dialog
        open={!!deleting && deleting.identity === identity && canWrite}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <DialogContent>
          <DialogTitle>删除会员等级</DialogTitle>
          <DialogDescription>
            确认删除 {deleting?.tier.name}？仍有有效会员时请改为下架。
          </DialogDescription>
          {error && <p role="alert">{error}</p>}
          <Button variant="outline" onClick={() => setDeleting(null)}>
            取消
          </Button>
          <Button disabled={operation.pending} onClick={() => void remove()}>
            确认删除
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
