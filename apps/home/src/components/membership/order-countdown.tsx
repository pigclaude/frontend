// 每秒更新服务器给定的订单到期时间，不推断支付状态，也不逐秒播报。
import { useEffect, useState } from "react"
/** 到期后停留零秒，最终订单状态仍以本人查单为准。 */
export function OrderCountdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000))
  const text = Number.isFinite(seconds)
    ? `${Math.floor(seconds / 60)
        .toString()
        .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`
    : "00:00"
  return <p aria-live="off">{text} 后过期</p>
}
