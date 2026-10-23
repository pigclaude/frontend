// 负责等级抽屉、300ms 服务端预览与保存归属，迟到回复不能覆盖新输入。
import { useEffect, useState, type FormEvent } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { Tier } from "@pigclaude/api/membership/types"
import { useAdminOperationOwner } from "@/hooks/use-admin-operation-owner"
import { adminSessionGeneration } from "@/lib/session-generation"
import { adminApi } from "@/lib/api"
import { refreshTierCatalog } from "@/components/tiers/refresh-tier-catalog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { draftFromTier, tierInput } from "./tier-draft"
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
  const [error, setError] = useState("")
  const [preview, setPreview] = useState<{ key: string; tier: Tier } | null>(null)
  const [previewError, setPreviewError] = useState<{ key: string; message: string } | null>(null)
  const key = JSON.stringify([identity, canWrite, draft])
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
  const disabled = !canWrite || saveOperation.pending
  const prices = preview?.key === key ? preview.tier.options : !canWrite ? tier?.options : undefined
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent className="overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{canWrite ? (tier ? "编辑等级" : "新建等级") : "查看等级"}</SheetTitle>
          <SheetDescription>1 个月按 30 天计。价格由服务端预览计算。</SheetDescription>
        </SheetHeader>
        <form className="flex flex-col gap-4 p-5" onSubmit={save}>
          <Label htmlFor="tier-name">名称</Label>
          <Input
            id="tier-name"
            value={draft.name}
            disabled={disabled}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <Label htmlFor="tier-code">代号</Label>
          <Input
            id="tier-code"
            value={draft.code}
            disabled={disabled || !!tier}
            onChange={(e) => setDraft({ ...draft, code: e.target.value })}
          />
          <Label htmlFor="tier-level">等级</Label>
          <Input
            id="tier-level"
            value={draft.level}
            disabled={disabled}
            onChange={(e) => setDraft({ ...draft, level: e.target.value })}
          />
          <Label htmlFor="tier-price">月价（元）</Label>
          <Input
            id="tier-price"
            value={draft.monthlyPrice}
            disabled={disabled}
            onChange={(e) => setDraft({ ...draft, monthlyPrice: e.target.value })}
          />
          <Label htmlFor="tier-tagline">说明</Label>
          <Textarea
            id="tier-tagline"
            value={draft.tagline}
            disabled={disabled}
            onChange={(e) => setDraft({ ...draft, tagline: e.target.value })}
          />
          <Label htmlFor="tier-enabled">上架</Label>
          <Switch
            id="tier-enabled"
            checked={draft.enabled}
            disabled={disabled}
            onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
          />
          <OptionRows
            options={draft.options}
            prices={prices}
            disabled={disabled}
            onChange={(options) => setDraft({ ...draft, options })}
          />
          {previewError?.key === key && <p role="alert">{previewError.message}</p>}
          {error && <p role="alert">{error}</p>}
          {canWrite && (
            <Button type="submit" disabled={saveOperation.pending}>
              保存等级
            </Button>
          )}
        </form>
      </SheetContent>
    </Sheet>
  )
}
