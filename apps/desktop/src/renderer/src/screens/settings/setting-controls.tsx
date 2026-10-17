// 负责设置行右侧的分段选择、滑块、下拉和锁定值控件。
import type { CSSProperties } from "react"
import { Icon } from "../../components/icon"

/** 分段选择：选中项高亮，点击已选中项不触发变化。 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          className={option.value === value ? "is-active" : undefined}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => option.value !== value && onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** 百分比滑块：右侧同步显示当前值，轨道填充到当前位置。 */
export function RangeControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  const fill = `${((value - min) / (max - min)) * 100}%`
  return (
    <div className="range-row">
      <input
        className="range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        style={{ "--v": fill } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="num">{value}%</span>
    </div>
  )
}

/** 原生下拉，外观沿用设计稿的 select。 */
export function SelectControl({
  label,
  value,
  options,
  width,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  width: number
  onChange: (value: string) => void
}) {
  return (
    <div className="select-wrap">
      <select
        className="select"
        style={{ width }}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </div>
  )
}

/** 由 pigclaude 固定、用户不能修改的值。 */
export function LockedValue({ children }: { children: string }) {
  return (
    <span className="locked" title="由 pigclaude 固定，不能修改">
      <Icon name="lock" small />
      {children}
    </span>
  )
}
