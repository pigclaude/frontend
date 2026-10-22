// 负责在原后台 Radix 表单版式中提交真实会员授予请求。
import { useState, type FormEvent } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { adminApi } from "@/lib/api"
import { useAdminOperationOwner } from "@/hooks/use-admin-operation-owner"
import { toastApiError } from "@/lib/errors"

/** 使用已存在的等级 ID 授予会员，服务端确认成功后刷新会员和审计。 */
export function GrantDialog({
  open,
  onOpenChange,
  onGranted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGranted: () => void
}) {
  const queryClient = useQueryClient()
  const [userId, setUserId] = useState("")
  const [tierId, setTierId] = useState("")
  const [duration, setDuration] = useState("1")
  const [remark, setRemark] = useState("")
  const operation = useAdminOperationOwner(open ? "grant-open" : "grant-closed")
  const canSubmit = [userId, tierId, duration, remark].every((value) => value.trim())
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return
    const owner = operation.begin()
    if (!owner) return
    try {
      const membership = await adminApi.membership.grants.create(
        {
          userId: userId.trim(),
          tierId: tierId.trim(),
          duration: duration.trim(),
          durationUnit: "day",
          valueFen: "0",
          remark: remark.trim(),
        },
        owner.isCurrent,
      )
      if (!owner.isCurrent()) return
      void queryClient.invalidateQueries({ queryKey: ["admin-memberships"] })
      void queryClient.invalidateQueries({ queryKey: ["admin-audits"] })
      window.dispatchEvent(new CustomEvent("pigclaude:admin-membership", { detail: membership }))
      toast.success(`已为用户 ${userId.trim()} 授予会员`)
      onGranted()
      onOpenChange(false)
    } catch (error) {
      if (owner.isCurrent()) toastApiError(error)
    } finally {
      owner.finish()
    }
  }
  return (
    <Dialog open={open} onOpenChange={(value) => !operation.pending && onOpenChange(value)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>人工授予会员</DialogTitle>
          <DialogDescription>
            该操作不收费，授予价值为 0，将记录操作人、等级、时长和备注。
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="grant-user">用户 ID</Label>
            <Input
              id="grant-user"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="grant-tier">等级 ID</Label>
            <Input
              id="grant-tier"
              value={tierId}
              onChange={(event) => setTierId(event.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="grant-duration">时长（天）</Label>
            <Input
              id="grant-duration"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="grant-remark">操作备注</Label>
            <Textarea
              id="grant-remark"
              rows={3}
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={operation.pending}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit || operation.pending}>
              {operation.pending ? "提交中…" : "确认授予"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
