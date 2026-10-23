// 统一结算栏与旧付款窗口的可见支付渠道选择。
import type { PayType } from "@pigclaude/api/membership/types"
import { ToggleGroup, ToggleGroupItem } from "@pigclaude/web-ui/components/toggle-group"
/** 单渠道直接显示说明，多渠道使用共享 ToggleGroup。 */
export function PaymentMethods({
  payTypes,
  value,
  onChange,
  disabled = false,
}: {
  payTypes: PayType[]
  value: PayType | ""
  onChange: (value: PayType) => void
  disabled?: boolean
}) {
  if (payTypes.length === 1) return <p>使用{payTypes[0] === "alipay" ? "支付宝" : "微信"}支付</p>
  return (
    <ToggleGroup
      type="single"
      aria-label="支付方式"
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next === "alipay" || next === "wxpay") onChange(next)
      }}
    >
      {payTypes.map((type) => (
        <ToggleGroupItem key={type} value={type}>
          {type === "alipay" ? "支付宝" : "微信"}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
