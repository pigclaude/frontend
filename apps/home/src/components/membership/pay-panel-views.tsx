// 展示支付载体、免费确认和三类终态，金额与权益均只使用服务器响应。
import { useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import type { Payment, PayType } from "@pigclaude/api/membership/types"
import { Button } from "@pigclaude/web-ui/components/button"
import { formatDurationSeconds, formatFen } from "@pigclaude/web-ui/lib/format"
import { OrderCountdown } from "./order-countdown"
import type { PaySummary } from "./pay-panel"
/** 明细不对浏览器金额做加减或费率换算。 */
export function PayDetails({ summary }: { summary: PaySummary }) {
  return (
    <div data-style={summary.cardStyle} className="rounded-xl border p-4">
      <p>{summary.title}</p>
      {summary.optionPriceFen !== null && <p>套餐金额 {formatFen(summary.optionPriceFen)}</p>}
      <p>已抵扣 {formatFen(summary.creditFen)}</p>
      {summary.bonusSeconds !== "0" && <p>另赠 {formatDurationSeconds(summary.bonusSeconds)}</p>}
      <p>应付 {formatFen(summary.payableFen)}</p>
    </div>
  )
}
/** 二维码字符串与图片载体分支保持独立。 */
export function QrView({
  payment,
  payType,
  mobile,
  expiresAt,
}: {
  payment: Extract<Payment, { kind: "qr" }>
  payType: PayType
  mobile: boolean
  expiresAt: string
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      {payment.qrcode ? (
        <div className="relative bg-white p-2">
          <QRCodeSVG value={payment.qrcode} aria-label="付款二维码" size={220} level="M" />
          <span
            aria-hidden="true"
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-white p-1 text-xs text-black"
          >
            {payType === "alipay" ? "支" : "微"}
          </span>
        </div>
      ) : payment.imageUrl ? (
        <img src={payment.imageUrl} alt="付款二维码" width={220} height={220} />
      ) : (
        <p>付款码暂不可用，请稍后重新查询订单</p>
      )}
      <p>请使用{payType === "wxpay" ? "微信" : "支付宝"}扫码</p>
      <OrderCountdown expiresAt={expiresAt} />
      {mobile && payType === "alipay" && payment.qrcode.startsWith("https://") && (
        <a href={payment.qrcode}>打开支付宝</a>
      )}
    </div>
  )
}
/** 收银台按钮显式打开窗口，拦截时保留真实链接。 */
export function CashierView({ url, opened }: { url: string; opened: boolean }) {
  const [success, setSuccess] = useState(opened)
  return (
    <div>
      <p>{success ? "已在新窗口打开收银台" : "浏览器阻止了新窗口，请点击下方链接打开收银台"}</p>
      <Button
        onClick={() => {
          const popup = window.open(url, "_blank")
          if (popup) popup.opener = null
          setSuccess(popup !== null)
        }}
      >
        前往收银台付款
      </Button>
      <a href={url} target="_blank" rel="noopener noreferrer">
        打开收银台
      </a>
    </div>
  )
}
/** 免费报价只要求确认，服务器建单响应仍决定实际支付分支。 */
export function FreeView({ confirm }: { confirm(): void }) {
  return (
    <div>
      <p>本次升级无需付款</p>
      <Button onClick={confirm}>确认升级</Button>
    </div>
  )
}
/** 成功权益有效期仅在刷新成功之后展示。 */
export function SuccessView({
  tierName,
  validUntil,
  finish,
}: {
  tierName: string
  validUntil?: string
  finish(): void
}) {
  return (
    <div>
      <p role="status">{tierName} 已生效</p>
      {validUntil && <p>有效期至 {validUntil}</p>}
      <Button onClick={finish}>完成</Button>
    </div>
  )
}
/** 仅有原意图时允许重新建单。 */
export function ExpiredView({ retry, canRecreate }: { retry(): void; canRecreate: boolean }) {
  return (
    <div>
      <p>付款码已过期</p>
      <Button onClick={retry}>{canRecreate ? "重新获取" : "返回选择"}</Button>
    </div>
  )
}
/** 复制结果可见，权限失败不会产生未处理的拒绝。 */
export function PendingReviewView({ orderNo }: { orderNo: string }) {
  const [message, setMessage] = useState<string | null>(null)
  async function copy() {
    try {
      await navigator.clipboard.writeText(orderNo)
      setMessage("单号已复制")
    } catch {
      setMessage("复制失败，请手动复制单号")
    }
  }
  return (
    <div>
      <p>付款已收到，正在人工核对</p>
      <p>{orderNo}</p>
      <Button aria-label="复制单号" onClick={() => void copy()}>
        复制单号
      </Button>
      {message && <p role="status">{message}</p>}
    </div>
  )
}
