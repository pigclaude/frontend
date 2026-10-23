// 负责支付渠道卡片和可访问的渠道开关。
import type { PayType } from "@pigclaude/api/membership/types"
import { AlipayIcon, WechatPayIcon } from "@/components/icon"
import { Switch } from "@/components/ui/switch"
/** 保留渠道值契约，仅切换用户选择的渠道。 */
export function PayTypeCards({
  value,
  disabled,
  onChange,
}: {
  value: PayType[]
  disabled: boolean
  onChange: (v: PayType[]) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(
        [
          ["alipay", "支付宝", AlipayIcon],
          ["wxpay", "微信", WechatPayIcon],
        ] as const
      ).map(([type, title, Icon]) => (
        <div key={type} className="flex items-center gap-3 rounded-lg border p-4">
          <Icon className="size-7" />
          <span className="flex-1">{title}</span>
          <Switch
            aria-label={title}
            checked={value.includes(type)}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange(checked ? [...value, type] : value.filter((item) => item !== type))
            }
          />
        </div>
      ))}
    </div>
  )
}
