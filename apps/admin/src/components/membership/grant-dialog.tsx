// 负责通过正式用户选择器授予等级，预览与写入绑定输入、页面和会话。
import { useMemo, useState, type FormEvent } from "react"
import { useLocation } from "react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { GrantInput, UserPick } from "@pigclaude/api/membership/types"
import { formatDurationSeconds, formatFen } from "@pigclaude/web-ui/lib/format"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { adminApi } from "@/lib/api"
import { useAdminOperationOwner } from "@/hooks/use-admin-operation-owner"
import { toastApiError } from "@/lib/errors"
import { parseUnits } from "@/components/tiers/tier-draft"
import { UserPicker } from "./user-picker"
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
  const parsed = useMemo(() => {
    if (!open || !canWrite || !user || !tierId || !remark.trim()) return { input: null }
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
  }, [open, canWrite, user, tierId, duration, durationUnit, value, remark])
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
  return (
    <Dialog open={open} onOpenChange={(next) => !operation.pending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>人工授予会员</DialogTitle>
          <DialogDescription>
            该操作不收费，将记录操作人、等级、时长、授予价值和备注。1 个月按 30 天计。
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="flex flex-col gap-1.5">
            <Label>用户</Label>
            <UserPicker value={user} onChange={setUser} disabled={disabled || !open} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>等级</Label>
            <Select value={tierId} onValueChange={setTierId} disabled={disabled}>
              <SelectTrigger aria-label="授予等级">
                <SelectValue placeholder="选择等级" />
              </SelectTrigger>
              <SelectContent>
                {tiers.data?.items.map((tier) => (
                  <SelectItem key={tier.id} value={tier.id}>
                    {tier.name}
                    {!tier.enabled && "（已下架）"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tiers.isError && (
              <p role="alert">
                等级加载失败{" "}
                <Button type="button" variant="ghost" onClick={() => void tiers.refetch()}>
                  重试
                </Button>
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="grant-duration">时长</Label>
            <div className="flex gap-2">
              <Input
                id="grant-duration"
                value={duration}
                disabled={disabled}
                onChange={(event) => setDuration(event.target.value)}
                required
              />
              <Select
                value={durationUnit}
                onValueChange={(unit) => setUnit(unit as GrantInput["durationUnit"])}
                disabled={disabled}
              >
                <SelectTrigger aria-label="时长单位">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">月</SelectItem>
                  <SelectItem value="day">天</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              {[1, 3, 6, 12].map((months) => (
                <Button
                  key={months}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => {
                    setDuration(String(months))
                    setUnit("month")
                  }}
                >
                  {months} 个月
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="grant-value">授予价值（元）</Label>
            <Input
              id="grant-value"
              inputMode="decimal"
              value={value}
              disabled={disabled}
              onChange={(event) => setValue(event.target.value)}
            />
            <p className="text-xs text-meta">用于以后升级补差，未收费填 0</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="grant-remark">操作备注</Label>
            <Textarea
              id="grant-remark"
              rows={3}
              value={remark}
              disabled={disabled}
              onChange={(event) => setRemark(event.target.value)}
              required
            />
          </div>
          {error && <p role="alert">{error}</p>}
          {parsed.input && !preview && !error && <p role="status">预览中…</p>}
          {preview && (
            <div className="rounded-lg border border-border p-3 text-sm">
              <p>
                生效后：{preview.tier.name}，到期 {preview.validUntil.slice(0, 10)}
              </p>
              {BigInt(preview.voidedRemainingSeconds) > 0n && (
                <p>
                  将清除 {user?.status === "active" ? (user.tierName ?? "原会员") : "原会员"} 剩余{" "}
                  {formatDurationSeconds(preview.voidedRemainingSeconds)}（价值{" "}
                  {formatFen(preview.voidedValueFen)}），折合 {preview.tier.name}{" "}
                  {formatDurationSeconds(preview.convertedSeconds)}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
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
      </DialogContent>
    </Dialog>
  )
}
