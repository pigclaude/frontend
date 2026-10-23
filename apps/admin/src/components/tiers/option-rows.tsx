// 负责档位表单及服务端预览价格，任何显示金额均直接来自响应。
import type { TierOption } from "@pigclaude/api/membership/types"
import { formatFen } from "@pigclaude/web-ui/lib/format"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { TierDraft } from "./tier-draft"
/** 档位只传输入意图，展示价格按请求顺序对应，不接收预览的临时身份。 */
export function OptionRows({
  options,
  prices,
  disabled,
  error,
  onChange,
}: {
  options: TierDraft["options"]
  prices?: TierOption[]
  disabled: boolean
  error?: string
  onChange: (options: TierDraft["options"]) => void
}) {
  function update(index: number, patch: Partial<TierDraft["options"][number]>) {
    onChange(options.map((o, i) => (i === index ? { ...o, ...patch } : o)))
  }
  return (
    <section aria-label="价格档位" className="flex flex-col gap-4">
      <h3 className="font-medium">价格档位</h3>
      {error && <p className="text-destructive">{error}</p>}
      {options.map((option, i) => (
        <div key={option.id ?? i} className="grid gap-3 rounded-lg border p-3">
          <Label htmlFor={`months-${i}`}>月数 {i + 1}</Label>
          <Input
            id={`months-${i}`}
            value={option.months}
            disabled={disabled}
            onChange={(e) => update(i, { months: e.target.value })}
          />
          <Label htmlFor={`kind-${i}`}>优惠方式 {i + 1}</Label>
          <ToggleGroup
            id={`kind-${i}`}
            type="single"
            aria-label={`优惠方式 ${i + 1}`}
            value={option.discountKind}
            disabled={disabled}
            onValueChange={(value) => {
              if (value === "none" || value === "amount" || value === "percent")
                update(i, { discountKind: value, value: value === "percent" ? "10" : "0" })
            }}
          >
            <ToggleGroupItem value="none">无</ToggleGroupItem>
            <ToggleGroupItem value="amount">立减</ToggleGroupItem>
            <ToggleGroupItem value="percent">打折</ToggleGroupItem>
          </ToggleGroup>
          <Label htmlFor={`value-${i}`}>优惠值 {i + 1}</Label>
          <Input
            id={`value-${i}`}
            value={option.value}
            disabled={disabled || option.discountKind === "none"}
            onChange={(e) => update(i, { value: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            {option.discountKind === "percent" ? "按几折输入，例如 7.5" : "立减按元输入"}
          </p>
          <Label htmlFor={`badge-${i}`}>角标 {i + 1}</Label>
          <Input
            id={`badge-${i}`}
            value={option.badge}
            disabled={disabled}
            onChange={(e) => update(i, { badge: e.target.value })}
          />
          <Button
            type="button"
            aria-label={`推荐 ${i + 1}`}
            aria-pressed={option.recommended}
            disabled={disabled}
            onClick={() =>
              onChange(
                options.map((o, index) => ({
                  ...o,
                  recommended: index === i ? !option.recommended : false,
                })),
              )
            }
          >
            推荐
          </Button>
          <Label htmlFor={`enabled-${i}`}>档位上架 {i + 1}</Label>
          <Switch
            id={`enabled-${i}`}
            checked={option.enabled}
            disabled={disabled}
            onCheckedChange={(enabled) => update(i, { enabled })}
          />
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => onChange(options.filter((_, index) => index !== i))}
          >
            移除档位 {i + 1}
          </Button>
          {prices?.[i] && (
            <div className="text-sm" aria-live="polite">
              <p>现价 {formatFen(prices[i].priceFen)}</p>
              <p>按月购买 {formatFen(prices[i].monthlyPurchaseFen)}</p>
              <p>省 {formatFen(prices[i].savedFen)}</p>
            </div>
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
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
    </section>
  )
}
