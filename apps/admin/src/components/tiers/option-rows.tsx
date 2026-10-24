// 负责紧凑档位行及服务端预览价格，任何显示金额均直接来自响应。
import { useId } from "react"
import { Star, Trash2 } from "lucide-react"
import type { DraftField } from "./tier-draft"
import type { TierOption } from "@pigclaude/api/membership/types"
import { formatFen } from "@pigclaude/web-ui/lib/format"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { TierDraft } from "./tier-draft"

const columns =
  "md:grid-cols-[56px_108px_88px_76px_36px_44px_minmax(0,1fr)_28px] md:items-center md:gap-2"
const labelClass = "text-xs text-meta md:hidden"

/** 档位只传输入意图，展示价格按请求顺序对应，不接收预览的临时身份。 */
export function OptionRows({
  options,
  prices,
  disabled,
  error,
  errors,
  onChange,
}: {
  options: TierDraft["options"]
  prices?: TierOption[]
  disabled: boolean
  errors?: Partial<Record<DraftField, string>>
  error?: string
  onChange: (options: TierDraft["options"]) => void
}) {
  const prefix = useId()
  function update(index: number, patch: Partial<TierDraft["options"][number]>) {
    onChange(options.map((option, i) => (i === index ? { ...option, ...patch } : option)))
  }
  function recommend(index: number) {
    onChange(
      options.map((option, i) => ({
        ...option,
        recommended: i === index ? !option.recommended : false,
      })),
    )
  }
  return (
    <section aria-label="价格档位" className="flex flex-col gap-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className={`hidden gap-3 pb-1 text-xs text-meta ${columns} md:grid`}>
        <span>月数</span>
        <span>优惠方式</span>
        <span>优惠值</span>
        <span>角标</span>
        <span>推荐</span>
        <span>上架</span>
        <span>服务端价格</span>
        <span className="sr-only">操作</span>
      </div>
      {options.map((option, i) => {
        return (
          <div
            key={option.id ?? i}
            className="rounded-lg border border-border p-3 md:rounded-none md:border-x-0 md:border-t-0 md:border-b md:border-border-soft md:px-0 md:py-3"
          >
            <div className={`grid grid-cols-2 gap-3 ${columns}`}>
              <div className="space-y-1">
                <span className={labelClass}>月数</span>
                <Input
                  aria-label={`月数 ${i + 1}`}
                  inputMode="numeric"
                  value={option.months}
                  disabled={disabled}
                  aria-invalid={!!errors?.[`option.${i}.months`]}
                  aria-describedby={
                    errors?.[`option.${i}.months`] ? `${prefix}-${i}-months` : undefined
                  }
                  onChange={(event) => update(i, { months: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <span className={labelClass}>优惠方式</span>
                <Select
                  value={option.discountKind}
                  disabled={disabled}
                  onValueChange={(value) => {
                    if (value === "none" || value === "amount" || value === "percent")
                      update(i, { discountKind: value, value: value === "percent" ? "10" : "0" })
                  }}
                >
                  <SelectTrigger aria-label={`优惠方式 ${i + 1}`} className="h-8 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">无优惠</SelectItem>
                    <SelectItem value="amount">立减</SelectItem>
                    <SelectItem value="percent">打折</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <span className={labelClass}>优惠值</span>
                <div className="relative">
                  <Input
                    aria-label={`优惠值 ${i + 1}`}
                    inputMode="decimal"
                    value={option.value}
                    disabled={disabled || option.discountKind === "none"}
                    aria-invalid={!!errors?.[`option.${i}.value`]}
                    aria-describedby={
                      errors?.[`option.${i}.value`] ? `${prefix}-${i}-value` : undefined
                    }
                    onChange={(event) => update(i, { value: event.target.value })}
                    className="pr-8"
                  />
                  <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-meta">
                    {option.discountKind === "amount"
                      ? "元"
                      : option.discountKind === "percent"
                        ? "折"
                        : ""}
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                <span className={labelClass}>角标</span>
                <Input
                  aria-label={`角标 ${i + 1}`}
                  value={option.badge}
                  disabled={disabled}
                  aria-invalid={!!errors?.[`option.${i}.badge`]}
                  aria-describedby={
                    errors?.[`option.${i}.badge`] ? `${prefix}-${i}-badge` : undefined
                  }
                  onChange={(event) => update(i, { badge: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <span className={labelClass}>推荐</span>
                <Button
                  type="button"
                  size="sm"
                  variant={option.recommended ? "default" : "ghost"}
                  aria-label={`推荐 ${i + 1}`}
                  aria-pressed={option.recommended}
                  disabled={disabled}
                  onClick={() => recommend(i)}
                  className="w-full md:size-6 md:justify-center md:px-0"
                >
                  <Star />
                  <span className="md:hidden">推荐</span>
                </Button>
              </div>
              <div className="flex items-center justify-between gap-2 md:block">
                <span className={labelClass}>上架</span>
                <Switch
                  aria-label={`档位上架 ${i + 1}`}
                  checked={option.enabled}
                  disabled={disabled}
                  onCheckedChange={(enabled) => update(i, { enabled })}
                />
              </div>
              <div className="col-span-2 space-y-1 md:col-span-1 md:space-y-0">
                <span className={labelClass}>服务端价格</span>
                <div className="text-xs leading-relaxed text-meta">
                  {prices?.[i] ? (
                    <>
                      <p>现价 {formatFen(prices[i].priceFen)}</p>
                      <p>按月 {formatFen(prices[i].monthlyPurchaseFen)}</p>
                      <p>省 {formatFen(prices[i].savedFen)}</p>
                    </>
                  ) : (
                    <p>—</p>
                  )}
                </div>
              </div>
              <div className="col-span-2 md:col-span-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`移除档位 ${i + 1}`}
                  disabled={disabled}
                  onClick={() => onChange(options.filter((_, index) => index !== i))}
                  className="w-full justify-start md:size-6 md:justify-center md:px-0"
                >
                  <Trash2 />
                  <span className="md:hidden">删除档位</span>
                </Button>
              </div>
            </div>
            {(errors?.[`option.${i}.months`] ||
              errors?.[`option.${i}.value`] ||
              errors?.[`option.${i}.badge`]) && (
              <div className="mt-2 space-y-1 text-xs text-destructive">
                {errors?.[`option.${i}.months`] && (
                  <p id={`${prefix}-${i}-months`}>
                    档位 {i + 1}：{errors[`option.${i}.months`]}
                  </p>
                )}
                {errors?.[`option.${i}.value`] && (
                  <p id={`${prefix}-${i}-value`}>
                    档位 {i + 1}：{errors[`option.${i}.value`]}
                  </p>
                )}
                {errors?.[`option.${i}.badge`] && (
                  <p id={`${prefix}-${i}-badge`}>
                    档位 {i + 1}：{errors[`option.${i}.badge`]}
                  </p>
                )}
              </div>
            )}
          </div>
        )
      })}
      <Button
        type="button"
        variant="outline"
        className="w-full border-dashed"
        disabled={disabled}
        onClick={() =>
          onChange([
            ...options,
            {
              months: "1",
              discountKind: "none",
              value: "0",
              badge: "",
              recommended: false,
              enabled: true,
            },
          ])
        }
      >
        添加档位
      </Button>
      <p className="text-xs text-meta">
        打折按几折输入，例如 7.5；立减按元输入。推荐档位每个等级最多一个。
      </p>
    </section>
  )
}
