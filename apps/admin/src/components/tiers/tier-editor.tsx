// 负责整页等级编辑器、300ms 服务端预览与保存归属，迟到回复不能覆盖新输入。
import { useEffect, useRef, useState, type FormEvent } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowLeft } from "lucide-react"
import type { Tier } from "@pigclaude/api/membership/types"
import { useResultGeneration } from "@/components/membership/use-result-generation"
import { useAdminOperationOwner } from "@/hooks/use-admin-operation-owner"
import { useMediaQuery } from "@/hooks/use-media-query"
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
  changedFields,
  draftErrors,
  draftFromTier,
  tierInput,
  type DraftField,
  type TierDraft,
} from "./tier-draft"
import { OptionRows } from "./option-rows"
import { EditorSection } from "./editor-section"

/** 编辑状态只从原等级初始化；预览只提供金额，原始 tier/option 身份永久保留。 */
export function TierEditor({
  tier,
  canWrite,
  identity,
  onClose,
  onSaved,
  onDirtyChange,
}: {
  tier: Tier | null
  canWrite: boolean
  identity: string
  onClose: () => void
  onSaved?: () => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const client = useQueryClient()
  const isMobile = useMediaQuery("(max-width: 767px)")
  const [draft, setDraft] = useState(() => draftFromTier(tier))
  // 字段错误只在用户改过该字段或点过保存之后显示，刚打开的新建页不报错。
  const [touched, setTouched] = useState<ReadonlySet<DraftField>>(() => new Set())
  const [attempts, setAttempts] = useState(0)
  const form = useRef<HTMLFormElement>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [error, setError] = useState("")
  const [preview, setPreview] = useState<{ key: string; tier: Tier } | null>(null)
  const [previewError, setPreviewError] = useState<{ key: string; message: string } | null>(null)
  const scope = JSON.stringify([identity, canWrite, draft])
  const { generation } = useResultGeneration(scope)
  const key = JSON.stringify([scope, generation.version, generation.session])
  const previewOperation = useAdminOperationOwner(key)
  const saveOperation = useAdminOperationOwner(JSON.stringify([identity, canWrite]))
  const dirty = canWrite && JSON.stringify(draft) !== JSON.stringify(draftFromTier(tier))
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [dirty])
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
  useEffect(() => {
    if (attempts) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [attempts])
  function edit(next: TierDraft) {
    setTouched(new Set([...touched, ...changedFields(draft, next)]))
    setDraft(next)
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canWrite) return
    let input
    try {
      input = tierInput(draft)
    } catch {
      // 错误已经写在各自的输入框下面，这里只把焦点带到第一个出错的字段。
      setAttempts((value) => value + 1)
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
      if (onSaved) onSaved()
      else onClose()
    } catch (cause) {
      if (owner.isCurrent()) setError(cause instanceof Error ? cause.message : "保存失败")
    } finally {
      owner.finish()
    }
  }
  function close() {
    if (saveOperation.pending) return
    if (dirty) setConfirmClose(true)
    else onClose()
  }
  const all = draftErrors(draft)
  const fields = Object.fromEntries(
    Object.entries(all).filter(
      ([field]) =>
        attempts > 0 ||
        field === "options" ||
        field === "benefit.8" ||
        touched.has(field as DraftField),
    ),
  ) as Partial<Record<DraftField, string>>
  const disabled = !canWrite || saveOperation.pending
  const prices = preview?.key === key ? preview.tier.options : !canWrite ? tier?.options : undefined
  const title = tier ? (canWrite ? `编辑 ${tier.name}` : `查看 ${tier.name}`) : "新建等级"
  return (
    <div data-testid="tier-editor" className="flex flex-col gap-6 pb-2">
      <header className="flex flex-col gap-4">
        <Button type="button" variant="ghost" className="-ml-2 w-fit" onClick={close}>
          <ArrowLeft className="size-4" />
          返回会员等级
        </Button>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-foreground">
              {title}
            </h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              1 个月按 30 天计，金额由服务端预览计算。
            </p>
          </div>
          <div className="hidden flex-wrap items-center gap-2 md:flex">
            <Button
              type="button"
              variant="outline"
              disabled={saveOperation.pending}
              onClick={close}
            >
              取消
            </Button>
            {canWrite && (
              <Button type="submit" form="tier-editor-form" disabled={saveOperation.pending}>
                保存等级
              </Button>
            )}
          </div>
        </div>
      </header>
      <form
        id="tier-editor-form"
        ref={form}
        onSubmit={save}
        className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]"
      >
        <div className="flex min-w-0 flex-col gap-5">
          <EditorSection title="基本信息">
            <div className="grid gap-4 sm:grid-cols-2">
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
                    onChange={(event) => edit({ ...draft, [field]: event.target.value })}
                  />
                  {fields[field] && (
                    <p id={`error-${field}`} className="text-sm text-danger-ink">
                      {fields[field]}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </EditorSection>
          <EditorSection title="卡面与标语" description="卡面颜色属于等级，不随主题色变化。">
            <div className="space-y-4">
              <CardStylePicker
                value={draft.cardStyle}
                disabled={disabled}
                onChange={(cardStyle) => edit({ ...draft, cardStyle })}
              />
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="tier-tagline">标语</Label>
                  <span className="text-xs text-meta">{[...draft.tagline].length}/24</span>
                </div>
                <Input
                  id="tier-tagline"
                  aria-invalid={!!fields.tagline}
                  aria-describedby={fields.tagline ? "error-tagline" : undefined}
                  value={draft.tagline}
                  disabled={disabled}
                  onChange={(e) => edit({ ...draft, tagline: e.target.value })}
                />
                {fields.tagline && (
                  <p id="error-tagline" className="text-sm text-danger-ink">
                    {fields.tagline}
                  </p>
                )}
              </div>
            </div>
          </EditorSection>
          <EditorSection title="权益" description="最多 8 条，每条最多 24 个字。">
            <BenefitListEditor
              errors={fields}
              value={draft.benefits}
              disabled={disabled}
              onChange={(benefits) => edit({ ...draft, benefits })}
            />
          </EditorSection>
          <EditorSection title="价格档位" description="优惠值和现价都由服务端预览计算。">
            <OptionRows
              errors={fields}
              error={fields.options}
              options={draft.options}
              prices={prices}
              disabled={disabled}
              onChange={(options) => edit({ ...draft, options })}
            />
          </EditorSection>
          <EditorSection title="上架状态">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="tier-enabled">上架</Label>
                <p className="mt-1 text-xs text-meta">
                  下架后用户端不可购买，已有会员权益不受影响。
                </p>
              </div>
              <Switch
                id="tier-enabled"
                checked={draft.enabled}
                disabled={disabled}
                onCheckedChange={(enabled) => edit({ ...draft, enabled })}
              />
            </div>
          </EditorSection>
        </div>
        <aside className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-20 xl:self-start">
          <div className="rounded-xl border border-border bg-background p-5">
            <TierPreview
              tier={
                preview?.key === key ? preview.tier : !canWrite ? (tier ?? undefined) : undefined
              }
            />
            {previewError?.key === key && (
              <p role="alert" className="mt-3 text-sm text-danger-ink">
                {previewError.message}
              </p>
            )}
            {error && (
              <p role="alert" className="mt-3 text-sm text-danger-ink">
                {error}
              </p>
            )}
          </div>
        </aside>
      </form>
      {isMobile && (
        <div className="sticky bottom-0 z-10 -mx-4 flex gap-2 border-t border-border-soft bg-background/95 px-4 py-3 backdrop-blur">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            disabled={saveOperation.pending}
            onClick={close}
          >
            取消
          </Button>
          {canWrite && (
            <Button
              type="submit"
              form="tier-editor-form"
              className="flex-1"
              disabled={saveOperation.pending}
            >
              保存等级
            </Button>
          )}
        </div>
      )}
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
    </div>
  )
}
