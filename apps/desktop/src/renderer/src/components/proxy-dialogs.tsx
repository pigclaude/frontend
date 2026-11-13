// 负责添加或编辑代理弹层；编辑时必须重新填写完整地址，保存后由代理列表统一测试出口。

import { desktopText } from "../locale/text"
import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog"
import { Button } from "./ui/button"
import { Input } from "./ui/input"

/** 添加或编辑代理弹层；editing 为空时是新增。 */
export function AddProxyDialog({
  open,
  onOpenChange,
  onConfirm,
  editing = null,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (url: string, name: string) => void
  editing?: { id: string; name: string } | null
}) {
  const [url, setUrl] = useState("")
  const [name, setName] = useState("")

  useEffect(() => {
    if (!open) return
    setUrl("")
    setName(editing?.name ?? "")
  }, [editing, open])
  const suffix =
    editing === null ? desktopText("pool.proxy-dialogs.1") : desktopText("pool.proxy-dialogs.2")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="dialog-head">
          <DialogTitle>
            {editing === null
              ? desktopText("pool.proxy-dialogs.3")
              : desktopText("pool.proxy-dialogs.4")}
          </DialogTitle>
          <DialogDescription>
            {editing === null
              ? desktopText("pool.proxy-dialogs.5")
              : desktopText("pool.proxy-dialogs.6")}
          </DialogDescription>
        </div>
        <div className="dialog-body">
          <div className="field">
            <label htmlFor="proxy-url">{desktopText("pool.proxy-dialogs.7")}</label>
            <Input
              id="proxy-url"
              className="mono"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={
                editing === null
                  ? "http://user:pass@host:8000"
                  : desktopText("pool.proxy-dialogs.8")
              }
            />
            <span className="hint">
              {editing === null
                ? desktopText("pool.proxy-dialogs.9")
                : desktopText("pool.proxy-dialogs.10")}
            </span>
          </div>
          <div className="field">
            <label htmlFor="proxy-name">{desktopText("pool.proxy-dialogs.11")}</label>
            <Input
              id="proxy-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="LA-01"
            />
          </div>
        </div>
        <div className="dialog-foot">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {desktopText("pool.proxy-dialogs.12")}
          </Button>
          <Button
            variant="primary"
            disabled={!url.trim() || !name.trim()}
            onClick={() => onConfirm(url.trim(), name.trim())}
          >
            {suffix}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
