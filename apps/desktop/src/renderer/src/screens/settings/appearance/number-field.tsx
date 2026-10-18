// 负责外观页的字号输入框：数字输入加「px」，步长 0.5，打字途中不跳值，失焦或回车时夹到范围内。
import { type KeyboardEvent, useState } from "react"
import { Input } from "../../../components/ui/input"
import { exactStepped, parseStepped, type SteppedRange } from "../../../models/number-input"

/** 渲染字号输入框。合法值立即生效；其余输入在失焦或回车时夹紧提交，空白或非数字时恢复原值。 */
export function NumberField({
  label,
  value,
  range,
  onChange,
}: {
  label: string
  value: number
  range: SteppedRange
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const next = parseStepped(draft, range)
    setDraft(null)
    if (next !== null && next !== value) onChange(next)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      commit()
    }
  }
  return (
    <span className="num-field">
      <Input
        type="number"
        className="num-input"
        aria-label={label}
        min={range.min}
        max={range.max}
        step={range.step}
        value={draft ?? String(value)}
        onChange={(event) => {
          setDraft(event.target.value)
          const next = exactStepped(event.target.value, range)
          if (next !== null && next !== value) onChange(next)
        }}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      <span className="num-unit">px</span>
    </span>
  )
}
