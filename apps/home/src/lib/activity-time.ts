// 负责把设备和网页登录的最近活跃时间转换成「正在使用」「N 天前活跃」这类文案。

const MINUTE = 60_000
const DAY = 86_400_000

/** 活跃文案、是否算正在使用，以及悬停时显示的完整本地时间。 */
export interface ActivityText {
  label: string
  active: boolean
  title: string
}

const pad = (value: number) => String(value).padStart(2, "0")

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/**
 * 按本地日历计算活跃文案：5 分钟内为正在使用，1 小时内按分钟，当天按小时，
 * 前一天为昨天，30 天内按天，更早显示月日。时间读不出来时返回空文案。
 */
export function formatActivity(lastSeenAt: string, now: Date): ActivityText {
  const seen = new Date(lastSeenAt)
  if (Number.isNaN(seen.getTime())) return { label: "", active: false, title: "" }
  const title = `${seen.getFullYear()}/${pad(seen.getMonth() + 1)}/${pad(seen.getDate())} ${pad(
    seen.getHours(),
  )}:${pad(seen.getMinutes())}`
  const elapsed = now.getTime() - seen.getTime()
  if (elapsed < 5 * MINUTE) return { label: "正在使用", active: true, title }
  if (elapsed < 60 * MINUTE)
    return { label: `${Math.floor(elapsed / MINUTE)} 分钟前活跃`, active: false, title }
  const days = Math.round((startOfDay(now) - startOfDay(seen)) / DAY)
  if (days <= 0)
    return { label: `${Math.floor(elapsed / (60 * MINUTE))} 小时前活跃`, active: false, title }
  if (days === 1) return { label: "昨天活跃", active: false, title }
  if (days <= 30) return { label: `${days} 天前活跃`, active: false, title }
  return { label: `${seen.getMonth() + 1} 月 ${seen.getDate()} 日活跃`, active: false, title }
}
