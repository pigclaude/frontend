// 负责分段切换。底层使用 Base UI RadioGroup，外观沿用 Pigcode 的 seg。
import { Radio as BaseRadio } from "@base-ui/react/radio"
import { RadioGroup as BaseRadioGroup, type RadioGroupProps } from "@base-ui/react/radio-group"
import type { ComponentProps } from "react"
import { cn } from "../../lib/cn"

type ToggleGroupProps = Omit<RadioGroupProps<string>, "value" | "onValueChange"> & {
  type?: "single" | "multiple"
  value?: string | undefined
  onValueChange?: ((value: string) => void) | undefined
}

/** 一组互斥的切换按钮；type 仅为兼容旧调用方保留。 */
export function ToggleGroup({
  className,
  type: _type,
  value,
  onValueChange,
  ...props
}: ToggleGroupProps) {
  void _type
  return (
    <BaseRadioGroup<string>
      className={cn("seg", className)}
      value={value}
      {...(onValueChange === undefined ? {} : { onValueChange })}
      {...props}
    />
  )
}

/** 切换组里的一项。 */
export function ToggleGroupItem({ className, ...props }: ComponentProps<typeof BaseRadio.Root>) {
  return (
    <BaseRadio.Root
      className={cn("seg-item", className)}
      nativeButton
      render={(renderProps, state) => (
        <button {...renderProps} type="button" data-state={state.checked ? "on" : "off"} />
      )}
      {...props}
    />
  )
}
