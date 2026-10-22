/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export function toNumber(v: string | number): number {
  return typeof v === "string" ? Number(v) : v
}

// fenToBigInt：把分金额(int64 JSON string 或整数 number)转 BigInt。用 BigInt 定点格式化,
// 避免 Number 强转在 >2^53 时丢精度——int64 金额契约以字符串承载正是为保精度,不能中途走 Number。
function fenToBigInt(fen: number | string): bigint {
  return typeof fen === "string" ? BigInt(fen) : BigInt(Math.trunc(fen))
}

/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export function formatFen(fen: number | string): string {
  const n = fenToBigInt(fen)
  const neg = n < 0n
  const abs = neg ? -n : n
  const yuan = (abs / 100n).toLocaleString("zh-CN") // 千分位分组(整数部分,BigInt 无精度损失)
  const cents = (abs % 100n).toString().padStart(2, "0")
  return (neg ? "−" : "") + "¥" + yuan + "." + cents
}

/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export function formatFenSigned(fen: number | string): string {
  const n = fenToBigInt(fen)
  const sign = n > 0n ? "+" : n < 0n ? "−" : ""
  const abs = n < 0n ? -n : n
  return sign + formatFen(abs.toString())
}

/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export function formatUsdtMicro(micro: number | string): string {
  // 服务端 USDT 金额恒对齐 0.01 USDT（payMicro = centiUsdt*10^4，尾数步长同为 0.01），
  // 两位小数无损；与原型 HXG.usdtMicro 一致。
  return (toNumber(micro) / 1e6).toFixed(2) + " USDT"
}

/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export function formatMicroUsd(micro: number | string): string {
  // 渠道成本（10^-6 USD）可能含亚分精度，保留到 4 位小数（至少 2 位）。
  return (
    (toNumber(micro) / 1e6).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }) + " USD"
  )
}

/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export function formatBytes(bytes: number | string): string {
  // 资产体积（int64 JSON string）→ 友好可读串：<1024 保留整数 B，其余 1 位小数 + KB/MB/GB。
  const n = toNumber(bytes)
  if (!Number.isFinite(n) || n < 0) return "—"
  if (n < 1024) return `${n} B`
  const units = ["KB", "MB", "GB"] as const
  let v = n
  let i = -1
  do {
    v /= 1024
    i++
  } while (v >= 1024 && i < units.length - 1)
  return `${v.toFixed(1)} ${units[i]}`
}

/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export function formatTime(ts: string | number | Date): string {
  const d = ts instanceof Date ? ts : new Date(ts)
  const p = (x: number) => String(x).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * Asia/Shanghai 固定时区时间（评审 R30 F2）：推广域时间戳的展示必须与日期过滤/聚合
 * 同口径（spec:86 后台按上海日历日审核）——formatTime 走浏览器本地时区，非 UTC+8
 * 浏览器下显示时间会与日期过滤冲突，导致按错误日历日审核。上海 = UTC+8 固定（无
 * 夏令时），直接偏移后按 UTC 访问器读取，结果与运行环境时区无关（可测）。
 */
/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export function formatTimeShanghai(ts: string | number | Date): string {
  const d = ts instanceof Date ? ts : new Date(ts)
  const s = new Date(d.getTime() + 8 * 3_600_000)
  const p = (x: number) => String(x).padStart(2, "0")
  return `${s.getUTCFullYear()}-${p(s.getUTCMonth() + 1)}-${p(s.getUTCDate())} ${p(s.getUTCHours())}:${p(s.getUTCMinutes())}`
}

/** 整数秒仅用于展示，按整天和剩余整小时截断，不参与业务定价。 */
export function formatDurationSeconds(seconds: string | number): string {
  const value = BigInt(seconds)
  return `${value / 86400n} 天 ${(value % 86400n) / 3600n} 小时`
}
