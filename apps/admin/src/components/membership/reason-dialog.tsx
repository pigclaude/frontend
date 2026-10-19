// 负责迁入成熟后台的reason-dialog布局和交互，使用本项目真实 API。
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

interface ReasonDialogProps {
  open: boolean
  title: string
  description: string
  reasonLabel?: string
  confirmLabel: string
  error?: string | null
  preserveWhitespace?: boolean
  maxCharacters?: number
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (reason: string) => void
}

/** ReasonDialog 保持列表、表单或分页的既有交互契约。 */
export function ReasonDialog({
  open,
  title,
  description,
  reasonLabel = "原因",
  confirmLabel,
  pending,
  error,
  preserveWhitespace = false,
  maxCharacters,
  onOpenChange,
  onConfirm,
}: ReasonDialogProps) {
  const [reason, setReason] = useState("")

  useEffect(() => {
    if (open) setReason("")
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(value) => !pending && onOpenChange(value)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error && <p role="alert">{error}</p>}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pc-action-reason">{reasonLabel}</Label>
          <Textarea
            id="pc-action-reason"
            rows={4}
            maxLength={maxCharacters === undefined ? 200 : maxCharacters * 2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="必填，说明操作原因"
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            取消
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => onConfirm(preserveWhitespace ? reason : reason.trim())}
            disabled={
              pending ||
              reason.trim().length === 0 ||
              (maxCharacters !== undefined && [...reason].length > maxCharacters)
            }
          >
            {pending ? "提交中…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
