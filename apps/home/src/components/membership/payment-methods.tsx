// 统一结算栏与付款面板的可见支付渠道选择，选中态使用主题色描边。
import type { PayType } from "@pigclaude/api/membership/types"
import { ToggleGroup, ToggleGroupItem } from "@pigclaude/web-ui/components/toggle-group"

const names: Record<PayType, string> = { alipay: "支付宝", wxpay: "微信" }

/** 单渠道直接显示说明，多渠道使用共享 ToggleGroup 分段控件。 */
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
  if (payTypes.length === 1)
    return (
      <p className="pay-method-single">
        <i className="pay-dot" data-channel={payTypes[0]} aria-hidden="true" />
        使用{names[payTypes[0]]}支付
      </p>
    )
  return (
    <ToggleGroup
      type="single"
      aria-label="支付方式"
      className="pay-methods"
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next === "alipay" || next === "wxpay") onChange(next)
      }}
    >
      {payTypes.map((type) => (
        <ToggleGroupItem key={type} value={type} className="pay-method">
          <i className="pay-dot" data-channel={type} aria-hidden="true" />
          {names[type]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
