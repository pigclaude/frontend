// 负责账号删除、代理切换和指纹编辑弹层。
import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import type { PoolAccount, PoolProxy } from "../fixtures/pool-fixtures"

/** 删除账号确认弹层。 */
export function AccountDeleteDialog({
  open,
  accountName,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  accountName: string
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="dialog-head">
          <DialogTitle>删除「{accountName}」？</DialogTitle>
          <DialogDescription>
            本机保存的凭据和指纹会一起删除，无法恢复。Claude 那边的账号不受影响。
          </DialogDescription>
        </div>
        <div className="dialog-foot">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="solidDanger" onClick={onConfirm}>
            删除
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 账号绑定代理切换弹层。 */
export function AccountProxyDialog({
  open,
  accountName,
  proxies,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  accountName: string
  proxies: PoolProxy[]
  onOpenChange: (open: boolean) => void
  onConfirm: (proxyId: string) => void
}) {
  const [selected, setSelected] = useState(proxies[0]?.id ?? "")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="dialog-head">
          <DialogTitle>给「{accountName}」更换代理</DialogTitle>
          <DialogDescription>登录和对话都会从新的代理出口发出。</DialogDescription>
        </div>
        <div className="dialog-body">
          <div className="group">
            {proxies.map((proxy) => (
              <Button
                variant="plain"
                key={proxy.id}
                className={selected === proxy.id ? "choice is-selected" : "choice"}
                type="button"
                onClick={() => setSelected(proxy.id)}
              >
                <span className="radio-dot" />
                <div className="grow">
                  <b>{proxy.name}</b>
                  <div className="desc">
                    {proxy.exit} · {proxy.region}
                  </div>
                </div>
                <span className={proxy.available ? "status ok" : "status bad"}>
                  {proxy.available ? `${proxy.latency} ms` : "不可用"}
                </span>
              </Button>
            ))}
          </div>
        </div>
        <div className="dialog-foot">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="primary" disabled={!selected} onClick={() => onConfirm(selected)}>
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 指纹配置编辑弹层。 */
export function FingerprintDialog({
  open,
  account,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  account: PoolAccount | null
  onOpenChange: (open: boolean) => void
  onConfirm: (fingerprint: string) => void
}) {
  const [fingerprint, setFingerprint] = useState(account?.fingerprint ?? "")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="dialog-head">
          <DialogTitle>编辑指纹</DialogTitle>
          <DialogDescription>保存后下次重新授权使用同一份指纹。</DialogDescription>
        </div>
        <div className="dialog-body">
          <div className="field">
            <label htmlFor="fingerprint-seed">种子</label>
            <Input
              id="fingerprint-seed"
              className="mono"
              value={fingerprint}
              onChange={(event) => setFingerprint(event.target.value)}
            />
          </div>
          <div className="field">
            <label>浏览器</label>
            <Input value="Chrome 141 · macOS" readOnly />
          </div>
          <p className="hint">建议和代理出口保持一致。</p>
        </div>
        <div className="dialog-foot">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="primary" onClick={() => onConfirm(fingerprint)}>
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
