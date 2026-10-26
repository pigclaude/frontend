// 负责添加或编辑代理弹层；编辑时必须重新填写完整地址，保存后由代理列表统一测试出口。

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
  const suffix = editing === null ? "添加" : "保存"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="dialog-head">
          <DialogTitle>{editing === null ? "添加代理" : "编辑代理"}</DialogTitle>
          <DialogDescription>
            {editing === null
              ? "建议使用出口固定的住宅或 ISP 代理。保存后可以点「全部测试」核对出口。"
              : "保存后需要重新测试出口。为保护密码，编辑时需要重新填写完整地址。"}
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
              placeholder={
                editing === null
                  ? "http://user:pass@host:8000"
                  : "重新填写完整地址 http://user:pass@host:8000"
              }
            />
            <span className="hint">
              {editing === null ? "支持 http、https；不支持 SOCKS5" : "重新填写完整地址，包含密码"}
            </span>
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
            {suffix}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
