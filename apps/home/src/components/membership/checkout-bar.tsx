// 展示所选方案摘要、服务端结算总额、抵扣赠时以及允许的支付渠道。
import type { PayType } from "@pigclaude/api/membership/types"
import { Button } from "@pigclaude/web-ui/components/button"
import { formatDurationSeconds, formatFen } from "@pigclaude/web-ui/lib/format"
import type { CheckoutModel } from "./checkout-model"
import { PaymentMethods } from "./payment-methods"
/** 宽屏作为右侧吸顶摘要卡，窄屏吸附视口底部；动作仅传递服务器档位意图。 */
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
  const offer = model.offer
  const notes = [
    offer?.kind === "upgrade_package" && offer.creditFen !== "0"
      ? `已抵扣 ${formatFen(offer.creditFen)}`
      : null,
    offer && offer.bonusSeconds !== "0"
      ? `另赠 ${formatDurationSeconds(offer.bonusSeconds)}`
      : null,
  ].filter((note) => note !== null)
  const card = model.cards.find((item) => item.code === model.selectedTier)
  const option = model.options.find((item) => item.id === model.selectedOptionId)
  return (
    <section className="checkout-bar" aria-label="结算">
      <div className="checkout-head">
        <span className="checkout-head-label">已选方案</span>
        <span className="checkout-head-plan">
          {card ? card.name : "—"}
          {option && <span> · {option.months} 个月</span>}
        </span>
        {option && option.savedFen !== "0" && (
          <span className="checkout-head-meta">
            {`${formatFen(option.perMonthFen)}/月 · 已省 ${formatFen(option.savedFen)}`}
          </span>
        )}
      </div>
      {payTypes.length ? (
        <PaymentMethods payTypes={payTypes} value={payType} onChange={onPayType} />
      ) : (
        <p className="checkout-offline">在线支付暂未开放，请稍后再来</p>
      )}
      <div className="checkout-total">
        <span className="checkout-total-label" aria-hidden="true">
          应付
        </span>
        <b>
          <span className="sr-only">应付 </span>
          {offer ? formatFen(offer.payableFen) : "—"}
        </b>
        {notes.length > 0 && (
          <p className="checkout-notes">
            {notes.map((note) => (
              <span key={note}>{note}</span>
            ))}
          </p>
        )}
      </div>
      <Button size="lg" className="checkout-cta" disabled={model.cta.disabled} onClick={onChoose}>
        {model.cta.label}
      </Button>
    </section>
  )
}
