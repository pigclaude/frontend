// 展示号池的可复用浏览器配置，配置 CRUD 与账号登录数据管理分开。

import { desktopText } from "../locale/text"
import { useEffect, useState } from "react"
import { ListRow, SettingPage, SettingSection } from "@pigclaude/ui-primitives"
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
    <SettingPage
      title={desktopText("pool.browser-profiles-screen.title")}
      sub={desktopText("pool.browser-profiles-screen.description")}
      actions={
        <>
          <Button variant="secondary" onClick={() => void controller.refresh()}>
            {desktopText("pool.browser-profiles-screen.refresh")}
          </Button>
          <Button variant="primary" onClick={() => setEditing("new")}>
            {desktopText("pool.browser-profiles-screen.create")}
          </Button>
        </>
      }
    >
      {controller.error ? (
        <p className="error-text" role="alert">
          {controller.error}
        </p>
      ) : null}
      {controller.loading && !controller.profiles.length ? (
        <p className="note">{desktopText("pool.browser-profiles-screen.loading")}</p>
      ) : null}
      {!controller.loading && !controller.profiles.length ? (
        <p className="note">{desktopText("pool.browser-profiles-screen.empty")}</p>
      ) : null}
      <SettingSection>
        {controller.profiles.map((profile) => {
          const proxy = proxies.find((item) => item.id === profile.proxyId)
          return (
            <ListRow
              key={profile.id}
              title={profile.name}
              description={
                <>
                  <span className="profile-description">
                    {profile.fingerprint.lang} · {profile.fingerprint.timezone} ·{" "}
                    {profile.proxyId
                      ? (proxy?.name ?? desktopText("pool.browser-profiles-screen.missingProxy"))
                      : desktopText("pool.browser-profiles-screen.systemNetwork")}
                  </span>
                  <span className="profile-description">
                    {profile.boundAccounts.length}
                    {desktopText("pool.browser-profiles-screen.accountCount")}
                    {profile.inUse ? desktopText("pool.browser-profiles-screen.inUse") : ""}
                  </span>
                  {profile.boundAccounts.length ? (
                    <span className="profile-description">
                      {profile.boundAccounts.map((account) => account.name).join("、")}
                    </span>
                  ) : null}
                </>
              }
              actions={
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={profile.inUse}
                    aria-label={desktopText("pool.browser-profiles-screen.editNamed", {
                      value1: String(profile.name),
                    })}
                    onClick={() => setEditing(profile)}
                  >
                    {desktopText("pool.browser-profiles-screen.edit")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={profile.inUse || profile.boundAccounts.length > 0}
                    aria-label={desktopText("pool.browser-profiles-screen.deleteNamed", {
                      value1: String(profile.name),
                    })}
                    onClick={() => setDeleting(profile)}
                  >
                    {desktopText("pool.browser-profiles-screen.delete")}
                  </Button>
                </>
              }
            />
          )
        })}
      </SettingSection>
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
            <DialogTitle>
              {desktopText("pool.browser-profiles-screen.deleteTitle", {
                name: deleting?.name ?? "",
              })}
            </DialogTitle>
            <DialogDescription>
              {desktopText("pool.browser-profiles-screen.deleteDescription")}
            </DialogDescription>
          </div>
          <div className="dialog-foot">
            <Button variant="ghost" disabled={deletingBusy} onClick={() => setDeleting(null)}>
              {desktopText("pool.browser-profiles-screen.cancel")}
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
              {desktopText("pool.browser-profiles-screen.confirmDelete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </SettingPage>
  )
}
