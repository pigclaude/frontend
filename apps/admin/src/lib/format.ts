// 负责格式化第一阶段后台列表中的时间和脱敏标识符。
/** 将服务端时间转换成稳定的本地可读格式。 */
export function formatTime(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false })
}

/** 仅保留标识符首尾片段，避免后台表格泄漏完整设备材料。 */
export function maskIdentifier(value: string): string {
  if (value.length <= 12) return value
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}
