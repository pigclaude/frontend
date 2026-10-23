// 将服务端授予预览展示为时间比例条；金额只格式化，不参与任何计算。
import type { GrantPreview, TierRef } from "@pigclaude/api/membership/types"
import { formatDurationSeconds, formatFen } from "@pigclaude/web-ui/lib/format"
import { formatTime } from "@/lib/format"
/** 时间条仅按服务端秒数和到期时间分配视觉宽度，标签独立排版避免窄屏截断。 */
export function GrantTimeline({
  now,
  preview,
  previousTier,
}: {
  now: string
  preview: GrantPreview
  previousTier: TierRef | null
}) {
  const remaining = BigInt(preview.voidedRemainingSeconds)
  const converted = BigInt(preview.convertedSeconds)
  const elapsed = Date.parse(preview.validUntil) - Date.parse(now)
  const totalNew = Number.isFinite(elapsed) ? BigInt(Math.max(0, Math.floor(elapsed / 1000))) : 0n
  const granted = totalNew > converted ? totalNew - converted : 0n
  const segments = [
    ...(remaining > 0n
      ? [
          {
            kind: "voided",
            seconds: remaining,
            label: `${previousTier?.name ?? "原会员"} 剩余 ${formatDurationSeconds(preview.voidedRemainingSeconds)} · 价值 ${formatFen(preview.voidedValueFen)} · 将清除`,
          },
        ]
      : []),
    { kind: "granted", seconds: granted, label: `到期 ${formatTime(preview.validUntil)}` },
    ...(converted > 0n
      ? [
          {
            kind: "converted",
            seconds: converted,
            label: `折算 ${formatDurationSeconds(preview.convertedSeconds)}`,
          },
        ]
      : []),
  ]
  const total = remaining + granted + converted
  return (
    <section
      className="min-w-0 space-y-3 rounded-lg border border-border p-3 text-sm"
      aria-label="授予时间线"
    >
      <p>
        生效后：{preview.tier.name}，到期 {formatTime(preview.validUntil)}
      </p>
      <div className="flex h-3 overflow-hidden rounded-full" aria-hidden="true">
        {segments.map((segment) => (
          <span
            key={segment.kind}
            data-timeline-segment={segment.kind}
            data-style={segment.kind === "voided" ? undefined : preview.tier.cardStyle}
            className={segment.kind === "voided" ? "bg-muted-foreground/40" : "tier-badge"}
            style={{
              flexGrow: total > 0n ? Number((segment.seconds * 1000000n) / total) : 1,
              flexBasis: 0,
              minWidth: 0,
              padding: 0,
              borderRadius: 0,
              opacity: segment.kind === "converted" ? 0.4 : 1,
            }}
          />
        ))}
      </div>
      <ul className="space-y-2 break-words">
        {segments.map((segment) => (
          <li key={segment.kind}>{segment.label}</li>
        ))}
      </ul>
    </section>
  )
}
