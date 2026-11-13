// 负责账号删除和代理切换弹层；指纹编辑已拆到 fingerprint-dialog。
import { desktopText } from "../locale/text"
import { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog"
import { Button } from "./ui/button"
import type { PoolProxy } from "../fixtures/pool-fixtures"
import { proxyDescription, proxyStatus, proxyStatusTone } from "../models/claude-account-view"
import { ListRow, SettingSection, StatusDot } from "@pigclaude/ui-primitives"

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
          <div className="dialog-heading">
            <DialogTitle className="dialog-title">
              {desktopText("pool.account-dialogs.deleteTitle", { name: accountName })}
            </DialogTitle>
            <DialogDescription className="dialog-desc">
              {desktopText("pool.account-dialogs.2")}
            </DialogDescription>
          </div>
        </div>
        <div className="dialog-foot">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {desktopText("pool.account-dialogs.3")}
          </Button>
          <Button variant="solidDanger" onClick={onConfirm}>
            {desktopText("pool.account-dialogs.4")}
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
          <div className="dialog-heading">
            <DialogTitle className="dialog-title">
              {desktopText("pool.account-dialogs.networkTitle", { name: accountName })}
            </DialogTitle>
            <DialogDescription className="dialog-desc">
              {desktopText("pool.account-dialogs.7")}
            </DialogDescription>
          </div>
        </div>
        <div className="dialog-body">
          <SettingSection>
            <ListRow
              render={<button type="button" />}
              aria-pressed={selected === ""}
              selected={selected === ""}
              onClick={() => setSelected("")}
              title={desktopText("pool.account-dialogs.8")}
              description={desktopText("pool.account-dialogs.9")}
            />
            {selected === null ? (
              <p className="error-text" role="alert">
                {desktopText("pool.account-dialogs.10")}
              </p>
            ) : null}
            {proxies.length === 0 ? (
              <p className="section-note">{desktopText("pool.account-dialogs.11")}</p>
            ) : null}
            {proxies.map((proxy) => (
              <ListRow
                render={<button type="button" />}
                key={proxy.id}
                aria-pressed={selected === proxy.id}
                selected={selected === proxy.id}
                onClick={() => setSelected(proxy.id)}
                title={proxy.name}
                description={proxyDescription(proxy)}
                meta={
                  <>
                    <StatusDot tone={proxyStatusTone(proxy)} />
                    {proxyStatus(proxy).label}
                  </>
                }
              />
            ))}
          </SettingSection>
        </div>
        <div className="dialog-foot">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {desktopText("pool.account-dialogs.12")}
          </Button>
          <Button
            variant="primary"
            disabled={selected === null}
            onClick={() => {
              if (selected === null) return
              onConfirm(selected === "" ? null : selected)
            }}
          >
            {desktopText("pool.account-dialogs.13")}
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
