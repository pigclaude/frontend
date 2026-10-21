// 负责添加代理弹层；保存后由代理列表统一测试出口。

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog"
import { Button } from "./ui/button"
import { Input } from "./ui/input"

/** 添加代理弹层。 */
export function AddProxyDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (url: string, name: string) => void
}) {
  const [url, setUrl] = useState("")
  const [name, setName] = useState("")

  useEffect(() => {
    if (!open) return
    setUrl("")
    setName("")
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="dialog-head">
          <DialogTitle>添加代理</DialogTitle>
          <DialogDescription>
            建议使用出口固定的住宅或 ISP 代理。保存后可以点「全部测试」核对出口。
          </DialogDescription>
        </div>
        <div className="dialog-body">
          <div className="field">
            <label htmlFor="proxy-url">地址</label>
            <Input
              id="proxy-url"
              className="mono"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="http://user:pass@host:8000"
            />
            <span className="hint">支持 http、https；不支持 SOCKS5</span>
          </div>
          <div className="field">
            <label htmlFor="proxy-name">名称</label>
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
            取消
          </Button>
          <Button
            variant="primary"
            disabled={!url.trim() || !name.trim()}
            onClick={() => onConfirm(url.trim(), name.trim())}
          >
            添加
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
