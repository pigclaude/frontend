// 负责等级抽屉、300ms 服务端预览与保存归属，迟到回复不能覆盖新输入。
import { useEffect, useState, type FormEvent } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { Tier } from "@pigclaude/api/membership/types"
import { useResultGeneration } from "@/components/membership/use-result-generation"
import { useAdminOperationOwner } from "@/hooks/use-admin-operation-owner"
import { adminSessionGeneration } from "@/lib/session-generation"
import { adminApi } from "@/lib/api"
import { refreshTierCatalog } from "@/components/tiers/refresh-tier-catalog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CardStylePicker } from "./card-style-picker"
import { BenefitListEditor } from "./benefit-list-editor"
import { TierPreview } from "./tier-preview"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { draftFromTier, tierInput, draftErrors } from "./tier-draft"
import { OptionRows } from "./option-rows"
/** 编辑状态只从原等级初始化；预览只提供金额，原始 tier/option 身份永久保留。 */
export function TierEditor({
  tier,
  canWrite,
  identity,
  onClose,
}: {
  tier: Tier | null
  canWrite: boolean
  identity: string
  onClose: () => void
}) {
  const client = useQueryClient()
  const [draft, setDraft] = useState(() => draftFromTier(tier))
  const [confirmClose, setConfirmClose] = useState(false)
  const [error, setError] = useState("")
  const [preview, setPreview] = useState<{ key: string; tier: Tier } | null>(null)
  const [previewError, setPreviewError] = useState<{ key: string; message: string } | null>(null)
  const scope = JSON.stringify([identity, canWrite, draft])
  const { generation } = useResultGeneration(scope)
  const key = JSON.stringify([scope, generation.version, generation.session])
  const previewOperation = useAdminOperationOwner(key)
  const saveOperation = useAdminOperationOwner(JSON.stringify([identity, canWrite]))
  useEffect(() => {
    if (!canWrite) return
    const session = adminSessionGeneration.current()
    const timer = setTimeout(() => {
      if (adminSessionGeneration.current() !== session) return
      let input
      try {
        input = tierInput(draft)
      } catch {
        return
      }
      const owner = previewOperation.begin()
      if (!owner) return
      void adminApi.membership.tiers
        .preview(input, owner.isCurrent)
        .then((value) => {
          if (owner.isCurrent()) {
            setPreview({ key, tier: value })
            setPreviewError(null)
          }
        })
        .catch((cause: unknown) => {
          if (owner.isCurrent())
            setPreviewError({
              key,
              message: cause instanceof Error ? cause.message : "预览失败，请修改输入后重试",
            })
        })
        .finally(owner.finish)
    }, 300)
    return () => clearTimeout(timer)
  }, [canWrite, draft, key, previewOperation.begin])
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canWrite) return
    let input
    try {
      input = tierInput(draft)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "输入无效")
      return
    }
    const owner = saveOperation.begin()
    if (!owner) return
    setError("")
    try {
      const { code, ...existing } = input
      await adminApi.membership.tiers.save(
        tier?.id ?? "new",
        tier ? existing : { ...existing, code },
        owner.isCurrent,
      )
      if (!owner.isCurrent()) return
      refreshTierCatalog(client)
      onClose()
    } catch (cause) {
      if (owner.isCurrent()) setError(cause instanceof Error ? cause.message : "保存失败")
    } finally {
      owner.finish()
    }
  }
  function close() {
    if (saveOperation.pending) return
    if (canWrite && JSON.stringify(draft) !== JSON.stringify(draftFromTier(tier)))
      setConfirmClose(true)
    else onClose()
  }
  const fields = draftErrors(draft)
  const disabled = !canWrite || saveOperation.pending
  const prices = preview?.key === key ? preview.tier.options : !canWrite ? tier?.options : undefined
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <SheetContent className="overflow-hidden sm:max-w-[560px]">
        <SheetHeader>
          <SheetTitle>{canWrite ? (tier ? "编辑等级" : "新建等级") : "查看等级"}</SheetTitle>
          <SheetDescription>1 个月按 30 天计。价格由服务端预览计算。</SheetDescription>
        </SheetHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={save}>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
            <section className="grid grid-cols-2 gap-3">
              <h3 className="col-span-2">基本信息</h3>
              {(
                [
                  ["name", "tier-name", "名称"],
                  ["code", "tier-code", "代号"],
                  ["level", "tier-level", "等级"],
                  ["monthlyPrice", "tier-price", "月价（元）"],
                ] as const
              ).map(([field, id, label]) => (
                <div key={field} className="space-y-2">
                  <Label htmlFor={id}>{label}</Label>
                  <Input
                    id={id}
                    value={draft[field]}
                    disabled={disabled || (field === "code" && !!tier)}
                    aria-invalid={!!fields[field]}
                    aria-describedby={fields[field] ? `error-${field}` : undefined}
                    onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                  />
                </div>
              ))}
            </section>
            <section className="space-y-3">
              <h3>卡面</h3>
              <CardStylePicker
                value={draft.cardStyle}
                disabled={disabled}
                onChange={(cardStyle) => setDraft({ ...draft, cardStyle })}
              />
              <Label htmlFor="tier-tagline">标语</Label>
              <Input
                id="tier-tagline"
                aria-invalid={!!fields.tagline}
                aria-describedby={fields.tagline ? "error-tagline" : undefined}
                value={draft.tagline}
                disabled={disabled}
                onChange={(e) => setDraft({ ...draft, tagline: e.target.value })}
              />
            </section>
            <BenefitListEditor
              errors={fields}
              value={draft.benefits}
              disabled={disabled}
              onChange={(benefits) => setDraft({ ...draft, benefits })}
            />
            <Label htmlFor="tier-enabled">上架</Label>
            <Switch
              id="tier-enabled"
              checked={draft.enabled}
              disabled={disabled}
              onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
            />
            <OptionRows
              errors={fields}
              error={fields.options}
              options={draft.options}
              prices={prices}
              disabled={disabled}
              onChange={(options) => setDraft({ ...draft, options })}
            />
            <div aria-label="字段错误">
              {Object.entries(fields)
                .filter(
                  ([field]) =>
                    field !== "options" &&
                    !field.startsWith("benefit.") &&
                    !field.startsWith("option."),
                )
                .map(([field, message]) => (
                  <p
                    key={field}
                    id={`error-${field}`}
                    className="text-destructive"
                    data-field={field}
                  >
                    {message}
                  </p>
                ))}
            </div>
            <TierPreview
              tier={
                preview?.key === key ? preview.tier : !canWrite ? (tier ?? undefined) : undefined
              }
            />
            {previewError?.key === key && <p role="alert">{previewError.message}</p>}
            {error && <p role="alert">{error}</p>}
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t bg-background p-5">
            <Button
              type="button"
              variant="outline"
              disabled={saveOperation.pending}
              onClick={close}
            >
              取消
            </Button>
            {canWrite && (
              <Button type="submit" disabled={saveOperation.pending}>
                保存等级
              </Button>
            )}
          </div>
        </form>
        <Dialog open={confirmClose && canWrite} onOpenChange={setConfirmClose}>
          <DialogContent>
            <DialogTitle>放弃未保存的修改？</DialogTitle>
            <DialogDescription>放弃后将恢复已保存的等级信息。</DialogDescription>
            <DialogFooter>
              <Button type="button" onClick={() => setConfirmClose(false)}>
                继续编辑
              </Button>
              <Button type="button" onClick={onClose}>
                放弃修改
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  )
}
