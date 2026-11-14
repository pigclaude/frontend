// 负责设置行右侧的分段选择、滑块、下拉和锁定值控件。
import { Icon } from "../../components/icon"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select"
import { Slider } from "../../components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group"

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
    <ToggleGroup
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(next) => next && next !== value && onChange(next as T)}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** 滑块：右侧同步显示当前值和单位（默认 %），轨道填充到当前位置；label 作为圆钮的读屏名称。 */
export function RangeControl({
  label,
  value,
  min,
  max,
  step,
  unit = "%",
  disabled,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <div className="range-row">
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        aria-label={label}
        {...(disabled === undefined ? {} : { disabled })}
        onValueChange={(next) => next[0] !== undefined && onChange(next[0])}
      />
      {/* 数值和单位保持为两个文本节点，与改动前 {value}% 的渲染逐像素一致 */}
      <span className="num">
        {value}
        {unit}
      </span>
    </div>
  )
}

/** 下拉选择，触发器外观沿用设计稿的 select；触发器里显示选中项的 label。 */
export function SelectControl({
  label,
  value,
  options,
  width,
  onChange,
}: {
  label: string
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
  width: number
  onChange: (value: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger style={{ width }} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
