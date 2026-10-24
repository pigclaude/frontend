// 负责通过正式用户选择器授予等级，预览与写入绑定输入、页面和会话；分区控件拆在同目录文件里。
import { useMemo, useState, type FormEvent } from "react"
import { useLocation } from "react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { GrantInput, Tier, UserPick } from "@pigclaude/api/membership/types"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { TierChoiceCards } from "./tier-choice-cards"
import { adminApi } from "@/lib/api"
import { useAdminOperationOwner } from "@/hooks/use-admin-operation-owner"
import { toastApiError } from "@/lib/errors"
import { parseUnits } from "@/components/tiers/tier-draft"
import { UserPicker } from "./user-picker"
import { GrantDurationField } from "./grant-duration-field"
import { GrantPreviewPanel } from "./grant-preview-panel"
import { grantError, useGrantPreview } from "./use-grant-preview"
/** 只提交通过当前预览的完整授予意图，成功后刷新会员和审计。 */
export function GrantDialog({
  open,
  onOpenChange,
  onGranted,
  canWrite = true,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGranted: () => void
  canWrite?: boolean
}) {
  const queryClient = useQueryClient()
  const location = useLocation()
  const [user, setUser] = useState<UserPick | null>(null)
  const [tierId, setTierId] = useState("")
  const [duration, setDuration] = useState("1")
  const [durationUnit, setUnit] = useState<GrantInput["durationUnit"]>("month")
  const [value, setValue] = useState("0")
  const [remark, setRemark] = useState("")
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
  const tiers = useQuery({
    queryKey: ["admin-tiers"],
    queryFn: adminApi.membership.tiers.list,
    enabled: open && canWrite,
    retry: false,
  })
  function lowerTierReason(tier: Tier) {
    return user?.status === "active" &&
      user.validUntil &&
      Date.parse(user.validUntil) > Date.now() &&
      user.tier &&
      user.tier.level > tier.level
      ? "已是更高等级，请先撤销"
      : null
  }
  const selectedTier = tiers.data?.items.find((tier) => tier.id === tierId)
  const blocked = selectedTier ? lowerTierReason(selectedTier) : null
  const parsed = useMemo(() => {
    if (!open || !canWrite || !user || !tierId || blocked || !remark.trim()) return { input: null }
    try {
      if (!/^[1-9]\d*$/.test(duration)) throw new Error("时长必须为正整数")
      const input: GrantInput = {
        userId: user.userId,
        tierId,
        duration,
        durationUnit,
        valueFen: parseUnits(value, 2),
        remark: remark.trim(),
      }
      return { input }
    } catch (cause) {
      return { input: null, error: cause instanceof Error ? cause.message : "输入无效" }
    }
  }, [open, canWrite, user, tierId, duration, durationUnit, value, remark, blocked])
  const key = JSON.stringify([
    location.key,
    open,
    canWrite,
    user,
    tierId,
    duration,
    durationUnit,
    value,
    remark,
  ])
  const previewResult = useGrantPreview(parsed.input, key)
  const operation = useAdminOperationOwner(key)
  const preview = previewResult?.preview
  const error = failure?.key === key ? failure.message : (parsed.error ?? previewResult?.error)
  const canSubmit = !!parsed.input && !!preview && !error && canWrite && open
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit || !parsed.input || !previewResult?.isCurrent()) return
    const owner = operation.begin()
    if (!owner) return
    const input = parsed.input
    try {
      const membership = await adminApi.membership.grants.create(input, owner.isCurrent)
      if (!owner.isCurrent()) return
      void queryClient.invalidateQueries({ queryKey: ["admin-memberships"] })
      void queryClient.invalidateQueries({ queryKey: ["admin-audits"] })
      window.dispatchEvent(new CustomEvent("pigclaude:admin-membership", { detail: membership }))
      toast.success(`已为用户 ${input.userId} 授予会员`)
      onGranted()
      onOpenChange(false)
    } catch (cause) {
      if (owner.isCurrent()) {
        setFailure({ key, message: grantError(cause) })
        toastApiError(cause)
      }
    } finally {
      owner.finish()
    }
  }
  const disabled = !canWrite || operation.pending
  const steps = [
    { label: "选择用户", done: !!user },
    { label: "选择等级", done: !!tierId && !blocked },
    { label: "填写时长", done: /^[1-9]\d*$/.test(duration) },
    { label: "填写操作备注", done: !!remark.trim() },
  ]
  return (
    <Dialog open={open} onOpenChange={(next) => !operation.pending && onOpenChange(next)}>
      <DialogContent className="max-h-[90dvh] overflow-hidden p-0 sm:max-w-4xl">
        <div className="flex max-h-[90dvh] min-h-0 flex-col">
          <DialogHeader className="border-b border-border-soft px-6 py-5">
            <DialogTitle>人工授予会员</DialogTitle>
            <DialogDescription>
              该操作不收费，将记录操作人、等级、时长、授予价值和备注。1 个月按 30 天计。
            </DialogDescription>
          </DialogHeader>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
            <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto px-6 py-5 md:grid-cols-[minmax(0,1fr)_300px]">
              <div className="flex min-w-0 flex-col gap-6">
                <div className="flex flex-col gap-1.5">
                  <Label>用户</Label>
                  <UserPicker value={user} onChange={setUser} disabled={disabled || !open} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>等级</Label>
                  <TierChoiceCards
                    tiers={tiers.data?.items ?? []}
                    value={tierId || null}
                    onChange={setTierId}
                    disabledReason={(tier) => (disabled ? "当前不可操作" : lowerTierReason(tier))}
                  />
                  {tiers.isError && (
                    <p role="alert">
                      等级加载失败{" "}
                      <Button type="button" variant="ghost" onClick={() => void tiers.refetch()}>
                        重试
                      </Button>
                    </p>
                  )}
                </div>
                <div className="grid gap-x-4 gap-y-6 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                  <GrantDurationField
                    duration={duration}
                    unit={durationUnit}
                    disabled={disabled}
                    onDuration={setDuration}
                    onUnit={setUnit}
                  />
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="grant-value">授予价值（元）</Label>
                    <div className="relative">
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-meta"
                      >
                        ¥
                      </span>
                      <Input
                        id="grant-value"
                        inputMode="decimal"
                        className="h-10 pl-7 text-sm tabular-nums"
                        value={value}
                        disabled={disabled}
                        onChange={(event) => setValue(event.target.value)}
                      />
                    </div>
                    <p className="text-xs text-meta">用于以后升级补差，未收费填 0</p>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="grant-remark">操作备注</Label>
                  <Textarea
                    id="grant-remark"
                    rows={3}
                    value={remark}
                    disabled={disabled}
                    placeholder="例如：活动赠送、客服补偿，会写入审计记录"
                    onChange={(event) => setRemark(event.target.value)}
                    required
                  />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
              </div>
              <aside className="flex min-w-0 flex-col gap-3 md:sticky md:top-0 md:self-start">
                <GrantPreviewPanel
                  user={user}
                  steps={steps}
                  preview={preview}
                  pending={!!parsed.input && !error}
                />
              </aside>
            </div>
            <DialogFooter className="mx-0 mb-0 mt-0 flex-row items-center justify-end border-t border-border-soft px-6 py-4">
              <p className="mr-auto hidden text-xs text-meta sm:block">
                授予立即生效，操作会写入审计日志
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={operation.pending}
                onClick={() => onOpenChange(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={!canSubmit || operation.pending}>
                {operation.pending ? "提交中…" : "确认授予"}
              </Button>
            </DialogFooter>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
