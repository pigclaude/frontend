// 负责给主题起名的对话框：「另存为自定义主题」和「重命名」共用，名字最多 40 个字符。
import { type FormEvent, useState } from "react"
import { Button } from "../../../components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../../components/ui/dialog"
import { Input } from "../../../components/ui/input"
import { maxThemeNameLength } from "../../../models/theme-library"

/** 渲染起名对话框。打开时输入框填 initialName；名字为空白时确认按钮不可点。 */
export function ThemeNameDialog({
  open,
  title,
  description,
  confirmLabel,
  initialName,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  initialName: string
  onOpenChange: (open: boolean) => void
  onConfirm: (name: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <NameForm
            title={title}
            description={description}
            confirmLabel={confirmLabel}
            initialName={initialName}
            onCancel={() => onOpenChange(false)}
            onConfirm={onConfirm}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function NameForm({
  title,
  description,
  confirmLabel,
  initialName,
  onCancel,
  onConfirm,
}: {
  title: string
  description: string
  confirmLabel: string
  initialName: string
  onCancel: () => void
  onConfirm: (name: string) => void
}) {
  const [name, setName] = useState(initialName)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim()) onConfirm(name)
  }
  return (
    <form onSubmit={submit}>
      <div className="dialog-head">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </div>
      <div className="dialog-body">
        <Input
          aria-label="主题名"
          value={name}
          maxLength={maxThemeNameLength}
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="dialog-foot">
        <Button type="button" variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          {confirmLabel}
        </Button>
      </div>
    </form>
  )
}
