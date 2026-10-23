// 负责只根据已保存配置推导支付健康状态。
import type { PayType } from "@pigclaude/api/membership/types"
/** 支付健康状态按关闭、缺密钥、无渠道、已启用顺序判定。 */
export type PaymentHealth = "enabled" | "disabled" | "missing-key" | "no-pay-type"
/** 草稿不参与健康状态，调用者必须提供已保存视图。 */
export function paymentHealth(view: {
  enabled: boolean
  keyConfigured: boolean
  payTypes: PayType[]
}): PaymentHealth {
  if (!view.enabled) return "disabled"
  if (!view.keyConfigured) return "missing-key"
  if (!view.payTypes.length) return "no-pay-type"
  return "enabled"
}
/** 使用固定状态色呈现已保存支付配置。 */
export function PaymentStatusBanner({ view }: { view: Parameters<typeof paymentHealth>[0] }) {
  const health = paymentHealth(view)
  const styles = {
    enabled: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    disabled: "bg-muted text-muted-foreground",
    "missing-key": "bg-amber-500/10 text-amber-800 dark:text-amber-400",
    "no-pay-type": "bg-amber-500/10 text-amber-800 dark:text-amber-400",
  }
  const messages = {
    enabled: "在线支付已启用",
    disabled: "在线支付已关闭",
    "missing-key": "已启用但缺少密钥",
    "no-pay-type": "已启用但未开放任何支付方式",
  }
  return (
    <div role="status" className={`rounded-lg px-4 py-3 text-sm ${styles[health]}`}>
      {messages[health]}
    </div>
  )
}
