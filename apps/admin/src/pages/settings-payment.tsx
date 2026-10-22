// 负责易支付分区加载与审计，未保存修改阻止分区和页面跳转。
import { useState } from "react"
import { useBeforeUnload, useBlocker } from "react-router"
import { usePaymentSettings } from "@/hooks/use-payment-settings"
import { SettingsNav } from "@/components/settings/settings-nav"
import { PaymentSettingsForm } from "@/components/settings/payment-settings-form"
import { TurnstileSettingsHistory } from "@/components/settings/turnstile-settings-history"
import { PageHead } from "@/components/shell/page-head"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
/** 支付分区只调用支付设置接口，并在权限丢失时由外层销毁。 */
export function SettingsPaymentPage({
  panels,
  onSelect,
}: {
  panels: { id: string; title: string }[]
  onSelect: (id: string) => void
}) {
  const settings = usePaymentSettings()
  const [dirty, setDirty] = useState(false)
  const blocker = useBlocker(dirty)
  useBeforeUnload((event) => {
    if (dirty) {
      event.preventDefault()
      event.returnValue = ""
    }
  })
  const { query, history } = settings
  return (
    <div className="flex flex-col gap-6">
      <PageHead
        title="系统设置"
        subtitle="易支付配置与变更历史"
        actions={
          <Button
            variant="outline"
            disabled={dirty || settings.busy || query.isFetching}
            onClick={() => void query.refetch()}
          >
            刷新配置
          </Button>
        }
      />
      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
        <SettingsNav panels={panels} active="payment" activeDirty={dirty} onSelect={onSelect} />
        <div className="min-w-0 space-y-4">
          {query.isPending ? (
            <p role="status">加载中…</p>
          ) : !query.data ? (
            <p role="alert">
              设置加载失败<Button onClick={() => void query.refetch()}>重试</Button>
            </p>
          ) : (
            <>
              {query.isError && <p role="alert">配置刷新失败，请撤销修改后刷新</p>}
              {!settings.canWrite && <p>只读权限，可查看配置与历史。</p>}
              {settings.error && <p role="alert">{settings.error}</p>}
              <PaymentSettingsForm
                key={query.data.revision}
                view={query.data}
                canWrite={settings.canWrite}
                busy={settings.busy}
                refreshFailed={query.isError || query.isFetching}
                onSave={settings.save}
                onDirtyChange={setDirty}
              />
              <TurnstileSettingsHistory
                data={history.data}
                error={history.isError}
                onNext={settings.setCursor}
                onRetry={() => void history.refetch()}
              />
            </>
          )}
        </div>
      </div>
      <Dialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.state === "blocked") blocker.reset()
        }}
      >
        <DialogContent>
          <DialogTitle>放弃未保存的修改？</DialogTitle>
          <DialogDescription>易支付还有未保存的修改，离开后这些修改会丢失。</DialogDescription>
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
