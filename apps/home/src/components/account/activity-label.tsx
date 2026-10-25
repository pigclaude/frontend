// 负责设备行和网页登录行说明里的活跃时间片段：正在使用带绿点，悬停显示完整时间。
import { formatActivity } from "@/lib/activity-time"

/** `lastSeenAt` 读不出来时不渲染任何内容，由调用方省略这一段。 */
export function ActivityLabel({ lastSeenAt, now }: { lastSeenAt: string; now: Date }) {
  const activity = formatActivity(lastSeenAt, now)
  if (!activity.label) return null
  return (
    <span title={activity.title} className="activity-label">
      {activity.active && <span aria-hidden="true" className="activity-dot" />}
      {activity.label}
    </span>
  )
}
