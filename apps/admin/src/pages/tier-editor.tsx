// 负责解析等级编辑路由、权限、目录数据和未保存离开保护。
import { useEffect, useRef, useState } from "react"
import { useBlocker, useMatch, useNavigate, useParams } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { adminApi } from "@/lib/api"
import { useAdminMe } from "@/hooks/use-admin-me"
import { tierPermissions } from "@/lib/admin-permissions"
import { TierEditor } from "@/components/tiers/tier-editor"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"

/** 从目录缓存或重新请求中解析当前等级；新建路由不请求目录。 */
export default function TierEditorPage() {
  const { tierId } = useParams()
  const creatingRoute = useMatch("/tiers/new")
  const navigate = useNavigate()
  const { data: me } = useAdminMe()
  const { canRead, canWrite } = tierPermissions(me)
  const creating = Boolean(creatingRoute) || tierId === "new"
  const editingId = creating ? "new" : tierId
  const [dirty, setDirty] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const allowLeave = useRef(false)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !allowLeave.current && currentLocation.pathname !== nextLocation.pathname,
  )
  useEffect(() => {
    if (blocker.state === "blocked") setLeaveOpen(true)
  }, [blocker.state])
  const query = useQuery({
    queryKey: ["admin-tiers", me?.id],
    queryFn: adminApi.membership.tiers.list,
    enabled: canRead && !creating,
    retry: false,
  })
  function leave() {
    allowLeave.current = true
    navigate("/tiers")
  }
  if (!canRead) return <p>没有查看会员等级的权限</p>
  if (!creating && query.isPending)
    return (
      <div aria-label="加载会员等级">
        <Skeleton className="h-96 rounded-xl" />
      </div>
    )
  if (!creating && query.isError)
    return (
      <EmptyState
        title="等级加载失败"
        action={<Button onClick={() => void query.refetch()}>重试</Button>}
      />
    )
  const tier = creating ? null : (query.data?.items.find((item) => item.id === editingId) ?? null)
  if (!creating && !tier)
    return (
      <EmptyState
        title="等级不存在或已删除"
        action={<Button onClick={() => navigate("/tiers")}>返回会员等级</Button>}
      />
    )
  return (
    <>
      <TierEditor
        key={`${me?.id}-${canWrite}-${editingId}`}
        tier={tier}
        canWrite={canWrite}
        identity={JSON.stringify([me?.id, editingId])}
        onClose={leave}
        onSaved={leave}
        onDirtyChange={setDirty}
      />
      <Dialog
        open={leaveOpen}
        onOpenChange={(open) => {
          if (open) return
          setLeaveOpen(false)
          if (blocker.state === "blocked") blocker.reset()
        }}
      >
        <DialogContent>
          <DialogTitle>放弃未保存的修改？</DialogTitle>
          <DialogDescription>离开后，本次修改不会保存。</DialogDescription>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                setLeaveOpen(false)
                if (blocker.state === "blocked") blocker.reset()
              }}
            >
              继续编辑
            </Button>
            <Button
              type="button"
              onClick={() => {
                allowLeave.current = true
                setLeaveOpen(false)
                if (blocker.state === "blocked") blocker.proceed()
              }}
            >
              放弃并离开
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
