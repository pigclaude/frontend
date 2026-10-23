// 负责会员等级权限、列表、编辑抽屉及删除确认。
import { useState } from "react"
import { useLocation } from "react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { Tier, TierInput } from "@pigclaude/api/membership/types"
import { ApiError } from "@pigclaude/api/client"
import { adminApi } from "@/lib/api"
import { refreshTierCatalog } from "@/components/tiers/refresh-tier-catalog"
import { useAdminMe } from "@/hooks/use-admin-me"
import { useAdminOperationOwner } from "@/hooks/use-admin-operation-owner"
import { tierPermissions } from "@/lib/admin-permissions"
import { PageHead } from "@/components/shell/page-head"
import { Button } from "@/components/ui/button"
import { TierDeleteDialog } from "@/components/tiers/tier-delete-dialog"
import { draftFromTier, tierInput } from "@/components/tiers/tier-draft"
import { Alert } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
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
  const [toggle, setToggle] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState("")
  const operation = useAdminOperationOwner(
    JSON.stringify([identity, canWrite, deleting?.tier.id, toggle]),
  )
  async function remove(unpublish = false) {
    if (!canWrite || !deleting || deleting.identity !== identity) return
    const owner = operation.begin()
    if (!owner) return
    setError("")
    try {
      if (toggle || unpublish) {
        const input: TierInput = tierInput(draftFromTier(deleting.tier))
        delete input.code
        await adminApi.membership.tiers.save(
          deleting.tier.id,
          { ...input, enabled: unpublish ? false : !deleting.tier.enabled },
          owner.isCurrent,
        )
      } else await adminApi.membership.tiers.remove(deleting.tier.id, owner.isCurrent)
      if (!owner.isCurrent()) return
      refreshTierCatalog(client)
      setDeleting(null)
    } catch (cause) {
      if (owner.isCurrent()) {
        setConflict(
          cause instanceof ApiError && cause.status === 409 && cause.code === "INVALID_STATE",
        )
        setError(
          cause instanceof ApiError && cause.status === 409 && cause.code === "INVALID_STATE"
            ? "还有有效会员，无法删除"
            : cause instanceof Error
              ? cause.message
              : "删除失败",
        )
      }
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
      {query.isPending && (
        <div aria-label="加载会员等级" className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      )}
      {query.isError && (
        <Alert>
          加载失败<Button onClick={() => void query.refetch()}>重试</Button>
        </Alert>
      )}
      {query.data?.items.length === 0 && (
        <EmptyState
          title="还没有会员等级"
          action={
            canWrite && (
              <Button onClick={() => setEditing({ tier: null, identity })}>新建等级</Button>
            )
          }
        />
      )}
      {!!query.data?.items.length && (
        <TierList
          tiers={query.data?.items ?? []}
          canWrite={canWrite}
          onEdit={(tier) => setEditing({ tier, identity })}
          onToggle={(tier) => {
            setError("")
            setConflict(false)
            setToggle(true)
            setDeleting({ tier, identity })
          }}
          onDelete={(tier) => {
            setConflict(false)
            setToggle(false)
            setError("")
            setDeleting({ tier, identity })
          }}
        />
      )}
      {editing?.identity === identity && (
        <TierEditor
          key={`${identity}-${canWrite}-${editing.tier?.id ?? "new"}`}
          tier={editing.tier}
          identity={identity}
          canWrite={canWrite}
          onClose={() => setEditing(null)}
        />
      )}
      <TierDeleteDialog
        open={!!deleting && deleting.identity === identity && canWrite}
        name={deleting?.tier.name}
        toggle={toggle}
        enabled={deleting?.tier.enabled}
        pending={operation.pending}
        error={error}
        conflict={conflict}
        onClose={() => setDeleting(null)}
        onConfirm={() => void remove()}
        onUnpublish={() => void remove(true)}
      />
    </div>
  )
}
