// 负责删除或启停的确认与错误反馈，不自行发起请求。
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
/** 确认动作的归属与 pending 由页面操作 owner 管理。 */
export function TierDeleteDialog({
  open,
  name,
  toggle,
  enabled,
  pending,
  error,
  conflict,
  onClose,
  onConfirm,
  onUnpublish,
}: {
  open: boolean
  name?: string
  toggle: boolean
  enabled?: boolean
  pending: boolean
  error: string
  conflict: boolean
  onClose: () => void
  onConfirm: () => void
  onUnpublish: () => void
}) {
  const action = toggle ? (enabled ? "下架" : "上架") : "删除"
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !pending) onClose()
      }}
    >
      <DialogContent>
        <DialogTitle>{action}会员等级</DialogTitle>
        <DialogDescription>
          确认{action} {name}？{!toggle && "仍有有效会员时请改为下架。"}
        </DialogDescription>
        {error && <p role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            取消
          </Button>
          <Button disabled={pending} onClick={onConfirm}>
            确认{action}
          </Button>
          {conflict && (
            <Button disabled={pending} onClick={onUnpublish}>
              改为下架
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
