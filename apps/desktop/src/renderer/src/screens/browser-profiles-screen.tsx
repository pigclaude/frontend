// 展示号池的可复用浏览器配置，配置 CRUD 与账号登录数据管理分开。

import { useEffect, useState } from "react"
import type { ProxyView } from "@pigclaude/contracts/claude-account"
import type { BrowserProfileView } from "@pigclaude/contracts/browser-profile"
import type { BrowserProfilesController } from "../hooks/use-browser-profiles"
import { BrowserProfileDialog } from "../components/browser-profile-dialog"
import { Button } from "../components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog"

/** 配置页由 App 中同一个控制器驱动，账号向导不会保存第二份列表。 */
export type BrowserProfilesScreenProps = {
  controller: BrowserProfilesController
  proxies: ProxyView[]
}

/** 绘制共享配置列表、使用状态与明确的删除确认。 */
export function BrowserProfilesScreen({ controller, proxies }: BrowserProfilesScreenProps) {
  useEffect(() => {
    void controller.refresh()
  }, [controller.refresh])
  const [editing, setEditing] = useState<BrowserProfileView | "new" | null>(null)
  const [deleting, setDeleting] = useState<BrowserProfileView | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>浏览器指纹</h1>
          <p className="sub">
            先创建浏览器配置，再给账号选择配置。多个账号可复用设置，登录数据各自独立。
          </p>
        </div>
        <div className="actions">
          <Button variant="secondary" onClick={() => void controller.refresh()}>
            刷新
          </Button>
          <Button variant="primary" onClick={() => setEditing("new")}>
            创建浏览器配置
          </Button>
        </div>
      </header>
      {controller.error ? (
        <p className="error-text" role="alert">
          {controller.error}
        </p>
      ) : null}
      {controller.loading && !controller.profiles.length ? (
        <p className="note">正在读取浏览器配置…</p>
      ) : null}
      {!controller.loading && !controller.profiles.length ? (
        <p className="note">还没有浏览器配置。创建后可以绑定代理、设定语言和时区，并供账号选择。</p>
      ) : null}
      <div className="group">
        {controller.profiles.map((profile) => {
          const proxy = proxies.find((item) => item.id === profile.proxyId)
          return (
            <div className="item" key={profile.id}>
              <div className="main">
                <span className="ttl">{profile.name}</span>
                <span className="desc">
                  {profile.fingerprint.lang} · {profile.fingerprint.timezone} ·{" "}
                  {profile.proxyId ? (proxy?.name ?? "原代理已不存在") : "系统网络"}
                </span>
                <span className="desc">
                  {profile.boundAccounts.length} 个账号使用 · 各账号登录数据独立
                  {profile.inUse ? " · 正在使用" : ""}
                </span>
                {profile.boundAccounts.length ? (
                  <span className="desc">
                    {profile.boundAccounts.map((account) => account.name).join("、")}
                  </span>
                ) : null}
              </div>
              <span className="trail">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={profile.inUse}
                  aria-label={`编辑 ${profile.name}`}
                  onClick={() => setEditing(profile)}
                >
                  编辑
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={profile.inUse || profile.boundAccounts.length > 0}
                  aria-label={`删除 ${profile.name}`}
                  onClick={() => setDeleting(profile)}
                >
                  删除
                </Button>
              </span>
            </div>
          )
        })}
      </div>
      {editing ? (
        <BrowserProfileDialog
          key={editing === "new" ? "new" : editing.id}
          profile={editing === "new" ? null : editing}
          proxies={proxies}
          onClose={() => setEditing(null)}
          onSave={controller.save}
          onRegion={controller.region}
        />
      ) : null}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !deletingBusy) setDeleting(null)
        }}
      >
        <DialogContent>
          <div className="dialog-head">
            <DialogTitle>删除「{deleting?.name}」的配置？</DialogTitle>
            <DialogDescription>
              仅删除这份未被账号引用的环境配置。账号凭据与登录数据由各账号单独管理。
            </DialogDescription>
          </div>
          <div className="dialog-foot">
            <Button variant="ghost" disabled={deletingBusy} onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button
              variant="solidDanger"
              disabled={deletingBusy}
              onClick={() => {
                if (!deleting) return
                setDeletingBusy(true)
                void controller
                  .remove(deleting.id)
                  .then(() => setDeleting(null))
                  .catch(() => undefined)
                  .finally(() => setDeletingBusy(false))
              }}
            >
              删除配置
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
