// 负责外观页的取值下拉：值与显示文字分开，触发器宽度由调用方给定。
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select"

/** 一个下拉选项。 */
export type Choice<T extends string> = { value: T; label: string }

/** 渲染下拉选择；label 是读屏名称，只在选中别的项时调用 onChange。 */
export function ChoiceSelect<T extends string>({
  label,
  value,
  options,
  width,
  onChange,
}: {
  label: string
  value: T
  options: readonly Choice<T>[]
  width: number
  onChange: (value: T) => void
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        const picked = options.find((option) => option.value === next)
        if (picked && picked.value !== value) onChange(picked.value)
      }}
    >
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
