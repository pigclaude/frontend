// 负责沿用固定 Pigcursor 系统设置布局并保护未保存修改的路由离开。
import { useState } from "react"
import { useBeforeUnload, useBlocker } from "react-router"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { PageHead } from "@/components/shell/page-head"
import { SettingsNav } from "@/components/settings/settings-nav"
import { TurnstileSettingsForm } from "@/components/settings/turnstile-settings-form"
import { TurnstileSettingsHistory } from "@/components/settings/turnstile-settings-history"
import { useSecuritySettings } from "@/hooks/use-security-settings"
/** 拒绝无读权限页面与加载失败空默认值，路由跳转使用 data router blocker。 */
export default function SettingsSecurityPage() {
  const settings = useSecuritySettings()
  const [dirty, setDirty] = useState(false)
  const blocker = useBlocker(dirty)
  useBeforeUnload((event) => {
    if (dirty) {
      event.preventDefault()
      event.returnValue = ""
    }
  })
  if (!settings.canRead) return <p role="alert">无权查看系统设置</p>
  const { query, history } = settings
  return (
    <div className="flex flex-col gap-6">
      <PageHead
        title="系统设置"
        subtitle="运营态配置以数据库为唯一来源；机密项加密存库、只写不回显"
        actions={
          <>
            <Badge variant="success" dot>
              免重启生效
            </Badge>
            <Button
              variant="outline"
              size="sm"
              disabled={dirty || settings.busy || query.isFetching}
              onClick={() => void query.refetch()}
            >
              刷新配置
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
        <SettingsNav
          panels={[{ id: "security", title: "安全风控" }]}
          active="security"
          activeDirty={dirty}
          onSelect={() => {}}
        />
        {query.isPending ? (
          <div role="status" className="rounded-xl border border-border bg-[var(--card-bg)] p-5">
            加载中…
          </div>
        ) : !query.data ? (
          <section className="rounded-xl border border-border bg-[var(--card-bg)] p-5">
            <h2>设置加载失败</h2>
            <p className="mt-2 text-xs text-meta">请重试后再编辑，避免以空值覆盖配置。</p>
            <Button className="mt-3" variant="outline" onClick={() => void query.refetch()}>
              重试
            </Button>
          </section>
        ) : (
          <div className="min-w-0 space-y-4">
            {query.isError && (
              <div role="alert">
                配置刷新失败，当前输入已保留。
                <Button
                  variant="outline"
                  disabled={dirty || settings.busy}
                  onClick={() => void query.refetch()}
                >
                  刷新配置
                </Button>
              </div>
            )}
            {!settings.canWrite && (
              <p className="text-xs text-meta">只读权限，可查看配置与历史。</p>
            )}
            {settings.error && (
              <p role="alert" className="text-sm text-destructive">
                {settings.error}
              </p>
            )}
            <TurnstileSettingsForm
              key={query.data.revision}
              view={query.data}
              canWrite={settings.canWrite}
              busy={settings.busy}
              refreshFailed={query.isError || query.isFetching}
              onDirtyChange={setDirty}
              onSave={settings.save}
              onActivate={settings.activate}
              onDisable={settings.disable}
            />
            <TurnstileSettingsHistory
              data={history.data}
              error={history.isError}
              onNext={settings.setCursor}
              onRetry={() => void history.refetch()}
            />
          </div>
        )}
      </div>
      <Dialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.state === "blocked") blocker.reset()
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>放弃未保存的修改？</DialogTitle>
            <DialogDescription>安全风控还有未保存的修改，离开后这些修改会丢失。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (blocker.state === "blocked") blocker.reset()
              }}
            >
              继续编辑
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setDirty(false)
                if (blocker.state === "blocked") blocker.proceed()
              }}
            >
              放弃修改并离开
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
