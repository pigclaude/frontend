// 负责人工授予的时长输入：数值、月/天单位分段控件和常用月数快捷选项排成一组。
import type { GrantInput } from "@pigclaude/api/membership/types"
import { cn } from "@pigclaude/web-ui/lib/utils"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

const presets = [1, 3, 6, 12]
const unitClass =
  "h-8 min-w-10 rounded-md px-3 text-[13px] text-muted-foreground transition-colors hover:text-foreground data-[state=on]:bg-[var(--seg-active)] data-[state=on]:text-foreground data-[state=on]:shadow-[var(--seg-active-shadow)] disabled:cursor-not-allowed"

/** 只回传原始输入和单位；快捷选项总是切回按月计。 */
export function GrantDurationField({
  duration,
  unit,
  disabled,
  onDuration,
  onUnit,
}: {
  duration: string
  unit: GrantInput["durationUnit"]
  disabled: boolean
  onDuration: (value: string) => void
  onUnit: (unit: GrantInput["durationUnit"]) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="grant-duration">时长</Label>
      <div className="flex gap-2">
        <Input
          id="grant-duration"
          inputMode="numeric"
          className="h-10 flex-1 text-sm tabular-nums"
          value={duration}
          disabled={disabled}
          onChange={(event) => onDuration(event.target.value)}
          required
        />
        <ToggleGroup
          type="single"
          value={unit}
          disabled={disabled}
          aria-label="时长单位"
          className="flex h-10 shrink-0 items-center gap-0.5 rounded-lg border border-border bg-raise-1 p-1"
          onValueChange={(next) => {
            if (next === "month" || next === "day") onUnit(next)
          }}
        >
          <ToggleGroupItem value="month" className={unitClass}>
            月
          </ToggleGroupItem>
          <ToggleGroupItem value="day" className={unitClass}>
            天
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((months) => {
          const active = unit === "month" && duration === String(months)
          return (
            <button
              key={months}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              className={cn(
                "h-7 rounded-full border border-border px-3 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
                active &&
                  "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-foreground",
              )}
              onClick={() => {
                onDuration(String(months))
                onUnit("month")
              }}
            >
              {months} 个月
            </button>
          )
        })}
      </div>
    </div>
  )
}
