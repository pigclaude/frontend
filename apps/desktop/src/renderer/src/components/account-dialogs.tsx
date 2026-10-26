// 负责账号删除、代理切换和指纹编辑弹层。
import { useEffect, useRef, useState } from "react"
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

/** 账号网络出口切换弹层；选中「不使用代理」时回调 null。 */
export function AccountProxyDialog({
  open,
  accountName,
  currentProxyId,
  proxies,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  accountName: string
  currentProxyId: string | null
  proxies: PoolProxy[]
  onOpenChange: (open: boolean) => void
  onConfirm: (proxyId: string | null) => void
}) {
  // 空字符串表示显式「不使用代理」；null 表示原代理已不存在、用户尚未重新选择。
  const [selected, setSelected] = useState<string | null>(() =>
    initialSelection(currentProxyId, proxies),
  )
  // 只在弹层从关闭变成打开时初始化，父组件重渲染不会重置用户的选择。
  const wasOpen = useRef(false)
  useEffect(() => {
    if (!open) {
      wasOpen.current = false
      return
    }
    if (wasOpen.current) return
    wasOpen.current = true
    setSelected(initialSelection(currentProxyId, proxies))
  }, [open, currentProxyId, proxies])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="dialog-head">
          <DialogTitle>给「{accountName}」设置网络出口</DialogTitle>
          <DialogDescription>
            绑定代理后，登录和对话都会从新的代理出口发出；不使用代理则走系统网络。
          </DialogDescription>
        </div>
        <div className="dialog-body">
          <div className="group">
            <Button
              variant="plain"
              className={selected === "" ? "choice is-selected" : "choice"}
              type="button"
              onClick={() => setSelected("")}
            >
              <span className="radio-dot" />
              <div className="grow">
                <b>不使用代理（系统网络直连）</b>
                <div className="desc">登录和对话都从本机网络发出</div>
              </div>
            </Button>
            {selected === null ? (
              <p className="error-text" role="alert">
                原代理已不存在，请重新选择网络出口
              </p>
            ) : null}
            {proxies.length === 0 ? (
              <p className="note">还没有代理。可以保存为系统网络直连。</p>
            ) : null}
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
          <Button
            variant="primary"
            disabled={selected === null}
            onClick={() => {
              if (selected === null) return
              onConfirm(selected === "" ? null : selected)
            }}
          >
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 网络出口弹层的初始选择；空字符串表示显式直连，null 表示原代理已不存在。 */
function initialSelection(currentProxyId: string | null, proxies: PoolProxy[]): string | null {
  if (currentProxyId === null) return ""
  return proxies.some((proxy) => proxy.id === currentProxyId) ? currentProxyId : null
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
  useEffect(() => {
    if (open) setFingerprint(account?.fingerprint ?? "")
  }, [open, account])
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
            <Input
              value={
                account?.fingerprintDetail
                  ? `${account.fingerprintDetail.brand} · ${account.fingerprintDetail.platform}`
                  : "Chrome · macOS"
              }
              readOnly
            />
          </div>
          <div className="field">
            <label>语言与时区</label>
            <Input
              value={
                account?.fingerprintDetail
                  ? `${account.fingerprintDetail.lang} · ${account.fingerprintDetail.timezone}`
                  : "en-US · America/Los_Angeles"
              }
              readOnly
            />
          </div>
          <p className="hint">建议和网络出口保持一致。</p>
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
