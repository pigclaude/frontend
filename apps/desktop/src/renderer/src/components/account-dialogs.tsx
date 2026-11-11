// 负责账号删除和代理切换弹层；指纹编辑已拆到 fingerprint-dialog。
import { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog"
import { Button } from "./ui/button"
import type { PoolProxy } from "../fixtures/pool-fixtures"
import { proxyDescription, proxyStatus, proxyStatusClass } from "../models/claude-account-view"

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
            本机账号凭据和该账号的浏览器登录数据会删除，共享浏览器配置保留。Claude
            那边的账号不受影响。
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
                  <div className="desc">{proxyDescription(proxy)}</div>
                </div>
                <span className={proxyStatusClass(proxy)}>{proxyStatus(proxy).label}</span>
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
