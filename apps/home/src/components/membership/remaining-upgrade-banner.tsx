// 展示服务端剩余有效期升级报价，作为时长区下方的次要入口。
import { formatFen } from "@pigclaude/web-ui/lib/format"
import type { CheckoutModel } from "./checkout-model"
import { remainingLabel } from "./membership-cards"
/** 只有选中对应等级时展示剩余升级入口；到期日不变由服务端报价保证。 */
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
    <button type="button" className="remaining-upgrade" disabled={disabled} onClick={onChoose}>
      <span>
        只想升级剩余的 {remainingLabel(offer.remainingSeconds)}？
        <b>补 {formatFen(offer.payableFen)}</b>，到期日不变
      </span>
      <span className="remaining-upgrade-action">剩余天数升级 ›</span>
    </button>
  )
}
