// 负责添加代理和展示代理连接测试结果弹层。
import { useState } from "react"
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
  const [testing, setTesting] = useState(false)
  const [tested, setTested] = useState(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="dialog-head">
          <DialogTitle>添加代理</DialogTitle>
          <DialogDescription>
            建议使用出口固定的住宅或 ISP 代理，添加前会先测试一次。
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
            <span className="hint">支持 http、https、socks5</span>
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
          {tested ? <p className="status ok">连接成功 · 186 ms · 203.0.113.42</p> : null}
        </div>
        <div className="dialog-foot">
          <Button
            className="left"
            variant="ghost"
            disabled={!url || testing}
            onClick={() => {
              setTesting(true)
              window.setTimeout(() => {
                setTesting(false)
                setTested(true)
              }, 500)
            }}
          >
            {testing ? "测试中…" : "测试连接"}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={!tested}
            onClick={() => onConfirm(url, name || "LA-01")}
          >
            添加
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
