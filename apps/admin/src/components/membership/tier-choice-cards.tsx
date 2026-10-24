// 提供人工授予用的紧凑等高等宽等级选择卡和键盘单选。
import type { CardStyle, Tier } from "@pigclaude/api/membership/types"
import { TierBadge } from "@pigclaude/web-ui/components/tier-badge"
import { formatFen } from "@pigclaude/web-ui/lib/format"

const accents: Record<CardStyle, string> = {
  azure: "linear-gradient(180deg,#3474e6,#1a3a7a)",
  gold: "linear-gradient(180deg,#f6dca8,#c99a48)",
  obsidian: "linear-gradient(180deg,#4d596b,#222934)",
  violet: "linear-gradient(180deg,#8b7cf6,#4c3fbd)",
  emerald: "linear-gradient(180deg,#34d399,#047857)",
  rose: "linear-gradient(180deg,#f472b6,#9d174d)",
}

function enabledRadios(group: HTMLElement) {
  return Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]')).filter(
    (radio) => !radio.disabled,
  )
}

/** 只提交所选等级 ID；禁用原因由当前授予意图提供。 */
export function TierChoiceCards({
  tiers,
  value,
  onChange,
  disabledReason,
}: {
  tiers: Tier[]
  value: string | null
  onChange: (id: string) => void
  disabledReason: (tier: Tier) => string | null
}) {
  return (
    <div
      role="radiogroup"
      aria-label="授予等级"
      className="grid gap-3 sm:grid-cols-2"
      onKeyDown={(event) => {
        const direction = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
        if (!direction && event.key !== "Home" && event.key !== "End") return
        const radios = enabledRadios(event.currentTarget)
        const current = radios.indexOf(event.target as HTMLButtonElement)
        if (current < 0 || !radios.length) return
        event.preventDefault()
        const index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? radios.length - 1
              : (current + (direction ?? 0) + radios.length) % radios.length
        const next = radios[index]
        next.focus()
        next.click()
      }}
    >
      {tiers.map((tier) => {
        const reason = disabledReason(tier)
        const selected = tier.id === value
        return (
          <button
            key={tier.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={reason !== null}
            disabled={reason !== null}
            onClick={() => {
              if (!reason) onChange(tier.id)
            }}
            className="relative flex min-h-[104px] flex-col items-start gap-2 overflow-hidden rounded-xl border border-border bg-background p-4 pl-5 text-left transition-[border-color,background-color,opacity] duration-150 outline-none aria-checked:border-[var(--accent)] aria-checked:bg-[var(--raise-2)] focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-55"
          >
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-1"
              style={{ background: accents[tier.cardStyle] }}
            />
            <span className="flex w-full items-center justify-between gap-2">
              <span className="text-base font-semibold text-foreground">{tier.name}</span>
              <span
                aria-hidden="true"
                className={`size-3.5 shrink-0 rounded-full border ${
                  selected ? "border-[var(--accent)] bg-[var(--accent)]" : "border-border"
                }`}
              />
            </span>
            <TierBadge name={`${tier.code} · 等级 ${tier.level}`} cardStyle={tier.cardStyle} />
            {tier.tagline && <span className="line-clamp-1 text-xs text-meta">{tier.tagline}</span>}
            <span className="mt-auto flex w-full items-center justify-between gap-2 text-xs text-meta">
              <span>{tier.monthlyPriceFen ? `${formatFen(tier.monthlyPriceFen)}/月` : "—"}</span>
              {!tier.enabled && <span>已下架</span>}
            </span>
            {reason && <span className="text-xs text-meta">{reason}</span>}
          </button>
        )
      })}
    </div>
  )
}
