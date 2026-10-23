// 展示服务端剩余有效期升级报价，独立于套餐结算。
import { Button } from "@pigclaude/web-ui/components/button"
import { formatDurationSeconds, formatFen } from "@pigclaude/web-ui/lib/format"
import type { CheckoutModel } from "./checkout-model"
/** 只有选中对应等级时展示剩余升级入口。 */
export function RemainingUpgradeBanner({
  offer,
  disabled,
  onChoose,
}: {
  offer: CheckoutModel["remainingUpgrade"]
  disabled: boolean
  onChoose: () => void
}) {
  if (!offer) return null
  return (
    <aside className="home-card">
      <p>保留剩余有效期，升级会员等级</p>
      <Button disabled={disabled} onClick={onChoose}>
        把剩余 {formatDurationSeconds(offer.remainingSeconds)}升级为 {offer.tierName}，补{" "}
        {formatFen(offer.payableFen)}
      </Button>
    </aside>
  )
}
