// 负责展示服务端给出的剩余时间升级方案，不在浏览器计算抵扣。
import type { RemainingUpgrade } from "@pigclaude/api/membership/types"
import { Button } from "@pigclaude/web-ui/components/button"
import { formatDurationSeconds, formatFen } from "@pigclaude/web-ui/lib/format"
/** 只在服务端提供剩余升级报价时显示购买入口。 */
export function UpgradeOffer({
  offer,
  name,
  onChoose,
}: {
  offer: RemainingUpgrade
  name: string
  onChoose: () => void
}) {
  return (
    <Button variant="outline" className="h-auto whitespace-normal" onClick={onChoose}>
      把剩余 {formatDurationSeconds(offer.remainingSeconds)}升级为 {name}，补{" "}
      {formatFen(offer.payableFen)}
    </Button>
  )
}
