// 展示服务端结算总额、抵扣赠时以及允许的支付渠道。
import type { PayType } from "@pigclaude/api/membership/types"
import { Button } from "@pigclaude/web-ui/components/button"
import { formatDurationSeconds, formatFen } from "@pigclaude/web-ui/lib/format"
import type { CheckoutModel } from "./checkout-model"
import { PaymentMethods } from "./payment-methods"
/** 窄屏结算栏保持贴底，动作仅传递服务器档位意图。 */
export function CheckoutBar({
  model,
  payTypes,
  payType,
  onPayType,
  onChoose,
}: {
  model: CheckoutModel
  payTypes: PayType[]
  payType: PayType | ""
  onPayType: (type: PayType) => void
  onChoose: () => void
}) {
  return (
    <section
      className="sticky bottom-0 z-10 flex flex-wrap items-center gap-4 rounded-xl border bg-background p-4 sm:static"
      aria-label="结算"
    >
      <div>
        <p>应付 {model.offer ? formatFen(model.offer.payableFen) : "—"}</p>
        {model.offer?.kind === "upgrade_package" && (
          <p>已抵扣 {formatFen(model.offer.creditFen)}</p>
        )}
        {model.offer && model.offer.bonusSeconds !== "0" && (
          <p>另赠 {formatDurationSeconds(model.offer.bonusSeconds)}</p>
        )}
      </div>
      <PaymentMethods payTypes={payTypes} value={payType} onChange={onPayType} />
      <Button disabled={model.cta.disabled} onClick={onChoose}>
        {model.cta.label}
      </Button>
    </section>
  )
}
