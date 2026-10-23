// 展示支付载体、免费确认和三类终态，金额与权益均只使用服务器响应。
import { useState, type ReactNode } from "react"
import { QRCodeSVG } from "qrcode.react"
import type { Payment, PayType, EntitlementResponse } from "@pigclaude/api/membership/types"
import { Button } from "@pigclaude/web-ui/components/button"
import { formatDurationSeconds, formatFen, formatTime } from "@pigclaude/web-ui/lib/format"
import { MembershipCard } from "@pigclaude/web-ui/components/membership-card"
import { AlipayMark, SuccessCheck, WechatPayMark } from "@/components/icon"
import { OrderCountdown } from "./order-countdown"
import type { PaySummary } from "./pay-panel"

function Line({ label, children, tone }: { label: string; children: ReactNode; tone?: "credit" }) {
  return (
    <div className="pay-line">
      <dt>{label}</dt>
      <dd data-tone={tone}>{children}</dd>
    </div>
  )
}

/** 面板顶部的目标等级小卡和商品名，副标题说明本次是开通、升级还是剩余升级。 */
export function PayHeader({ summary }: { summary: PaySummary }) {
  return (
    <div className="pay-header">
      <MembershipCard size="xs" name={summary.tierName} cardStyle={summary.cardStyle} />
      <div className="min-w-0">
        <p className="pay-header-title">{summary.title}</p>
        <p className="pay-header-meta">
          {summary.creditFen !== "0" ? "升级 · 立即生效" : "支付成功后立即生效"}
        </p>
      </div>
    </div>
  )
}

/** 明细不对浏览器金额做加减或费率换算；零抵扣、零赠送和剩余升级的档位价都不显示。 */
export function PayDetails({ summary, remaining }: { summary: PaySummary; remaining: boolean }) {
  return (
    <dl className="pay-details">
      {!remaining && summary.optionPriceFen !== null && (
        <Line label="档位价">{formatFen(summary.optionPriceFen)}</Line>
      )}
      {summary.creditFen !== "0" && (
        <Line label="剩余价值抵扣" tone="credit">
          −{formatFen(summary.creditFen)}
        </Line>
      )}
      {summary.bonusSeconds !== "0" && (
        <Line label="另赠">{formatDurationSeconds(summary.bonusSeconds)}</Line>
      )}
      <div className="pay-total">
        <dt>应付</dt>
        <dd>{formatFen(summary.payableFen)}</dd>
      </div>
    </dl>
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
  const channel = payType === "wxpay" ? "微信" : "支付宝"
  return (
    <div className="pay-qr">
      {payment.qrcode ? (
        <div className="pay-qr-code">
          <QRCodeSVG value={payment.qrcode} aria-label="付款二维码" size={196} level="M" />
          <span className="pay-qr-mark" data-channel={payType} aria-hidden="true">
            {payType === "wxpay" ? <WechatPayMark /> : <AlipayMark />}
          </span>
        </div>
      ) : payment.imageUrl ? (
        <img
          className="pay-qr-code"
          src={payment.imageUrl}
          alt="付款二维码"
          width={196}
          height={196}
        />
      ) : (
        <p className="pay-note">付款码暂不可用，请稍后重新查询订单</p>
      )}
      <p className="pay-qr-caption">请使用{channel}扫码支付</p>
      <OrderCountdown expiresAt={expiresAt} />
      {mobile && payType === "alipay" && payment.qrcode.startsWith("https://") && (
        <Button asChild className="pay-alipay-link w-full">
          <a href={payment.qrcode}>打开支付宝</a>
        </Button>
      )}
    </div>
  )
}

/** 收银台按钮显式打开窗口，拦截时保留真实链接。 */
export function CashierView({ url, opened }: { url: string; opened: boolean }) {
  const [success, setSuccess] = useState(opened)
  return (
    <div className="pay-state">
      <p className="pay-note">
        {success ? "已在新窗口打开收银台" : "浏览器阻止了新窗口，请点击下方链接打开收银台"}
      </p>
      <Button
        className="w-full"
        onClick={() => {
          const popup = window.open(url, "_blank")
          if (popup) popup.opener = null
          setSuccess(popup !== null)
        }}
      >
        前往收银台付款
      </Button>
      <a className="pay-link" href={url} target="_blank" rel="noopener noreferrer">
        打开收银台
      </a>
    </div>
  )
}

/** 免费报价只要求确认，服务器建单响应仍决定实际支付分支。 */
export function FreeView({ confirm }: { confirm(): void }) {
  return (
    <div className="pay-state">
      <span className="pay-free-mark" aria-hidden="true">
        ¥0
      </span>
      <p className="pay-state-title">本次升级无需付款</p>
      <p className="pay-note">当前会员的剩余价值足够抵扣</p>
      <Button className="w-full" onClick={confirm}>
        确认升级
      </Button>
    </div>
  )
}

/** 冻结订单履行与刷新后的当前权益分别表述，历史回跳不冒充新开通。 */
export function SuccessView({
  tierName,
  historical,
  entitlement,
  finish,
}: {
  tierName: string
  historical: boolean
  entitlement?: EntitlementResponse
  finish(): void
}) {
  const active = entitlement?.status === "active"
  const fresh = !historical && active
  const until = entitlement?.validUntil ? formatTime(entitlement.validUntil).slice(0, 10) : null
  const current = active
    ? (entitlement.tier?.name ?? "会员")
    : entitlement?.status === "expired"
      ? "已过期"
      : entitlement?.status === "revoked"
        ? "已撤销"
        : "未开通"
  return (
    <div className="pay-state">
      <span className="pay-success-mark">
        <SuccessCheck />
      </span>
      <p className="pay-state-title" role="status">
        {fresh ? `${tierName} 已生效` : "本订单已生效"}
      </p>
      {fresh ? (
        until && <p className="pay-note">有效期至 {until} · 桌面端已可使用</p>
      ) : (
        <p className="pay-note">
          <span>当前会员：{current}</span>
          {until && <span> · 当前权益有效期至 {until}</span>}
        </p>
      )}
      <Button className="w-full" onClick={finish}>
        完成
      </Button>
    </div>
  )
}

/** 仅有原意图时允许重新建单。 */
export function ExpiredView({ retry, canRecreate }: { retry(): void; canRecreate: boolean }) {
  return (
    <div className="pay-state">
      <p className="pay-state-title">付款码已过期</p>
      <p className="pay-note">15 分钟内未完成支付，付款码已失效</p>
      <Button className="w-full" onClick={retry}>
        {canRecreate ? "重新获取" : "返回选择"}
      </Button>
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
    <div className="pay-state">
      <p className="pay-state-title">付款已收到，正在人工核对</p>
      <p className="pay-note">如有疑问请联系客服并提供单号</p>
      <p className="pay-order-no">{orderNo}</p>
      <Button variant="outline" className="w-full" onClick={() => void copy()}>
        复制单号
      </Button>
      {message && (
        <p className="pay-note" role="status">
          {message}
        </p>
      )}
    </div>
  )
}
