// 负责权益条目的添加、删除、顺序和字数提示。
import { useId } from "react"
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react"
import type { DraftField } from "./tier-draft"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

/** 保留输入原文，提交时由统一校验器 trim。 */
export function BenefitListEditor({
  value,
  disabled,
  onChange,
  errors,
}: {
  errors?: Partial<Record<DraftField, string>>
  value: string[]
  disabled: boolean
  onChange: (value: string[]) => void
}) {
  const prefix = useId()
  function move(index: number, delta: number) {
    const next = [...value]
    ;[next[index], next[index + delta]] = [next[index + delta], next[index]]
    onChange(next)
  }
  return (
    <div className="flex flex-col gap-3">
      {value.map((text, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="mt-2 w-5 shrink-0 text-right text-xs text-meta">{i + 1}</span>
          <div className="min-w-0 flex-1 space-y-1">
            <Input
              aria-label={`权益 ${i + 1}`}
              aria-invalid={!!errors?.[`benefit.${i}`]}
              aria-describedby={errors?.[`benefit.${i}`] ? `${prefix}-benefit-${i}` : undefined}
              value={text}
              disabled={disabled}
              onChange={(event) =>
                onChange(value.map((item, index) => (index === i ? event.target.value : item)))
              }
            />
            {errors?.[`benefit.${i}`] && (
              <p id={`${prefix}-benefit-${i}`} className="text-xs text-destructive">
                权益 {i + 1}：{errors[`benefit.${i}`]}
              </p>
            )}
          </div>
          <span className="mt-2 w-10 shrink-0 text-right text-xs text-meta">
            {[...text].length}/24
          </span>
          <div className="flex shrink-0 gap-1">
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              disabled={disabled || i === 0}
              onClick={() => move(i, -1)}
              aria-label={`上移权益 ${i + 1}`}
            >
              <ChevronUp />
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              disabled={disabled || i === value.length - 1}
              onClick={() => move(i, 1)}
              aria-label={`下移权益 ${i + 1}`}
            >
              <ChevronDown />
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              disabled={disabled}
              onClick={() => onChange(value.filter((_, index) => index !== i))}
              aria-label={`删除权益 ${i + 1}`}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
      ))}
      {errors?.["benefit.8"] && <p className="text-xs text-destructive">{errors["benefit.8"]}</p>}
      {value.length === 0 && (
        <p className="text-xs text-meta">还没有权益，添加后会显示在会员卡上。</p>
      )}
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          className="border-dashed"
          disabled={disabled || value.length >= 8}
          onClick={() => onChange([...value, ""])}
        >
          添加权益
        </Button>
        <span className="text-xs text-meta">{value.length}/8</span>
      </div>
    </div>
  )
}
