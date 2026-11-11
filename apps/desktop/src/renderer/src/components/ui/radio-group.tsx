// 负责单选组。底层使用 Base UI RadioGroup，圆点样式来自 Pigcode token。
import { Radio as BaseRadio } from "@base-ui/react/radio"
import { RadioGroup as BaseRadioGroup } from "@base-ui/react/radio-group"
import type { ComponentProps } from "react"
import { cn } from "../../lib/cn"

/** 一组互斥的单选项。 */
export function RadioGroup({
  className,
  orientation: _orientation,
  ...props
}: ComponentProps<typeof BaseRadioGroup> & { orientation?: "horizontal" | "vertical" }) {
  void _orientation
  return <BaseRadioGroup className={cn("radio-group", className)} {...props} />
}

/** 单选组里的一项，选中时显示实心圆点。 */
export function RadioGroupItem({ className, ...props }: ComponentProps<typeof BaseRadio.Root>) {
  return (
    <BaseRadio.Root
      className={cn("radio", className)}
      render={(renderProps, state) => (
        <span {...renderProps} data-state={state.checked ? "checked" : "unchecked"} />
      )}
      {...props}
    >
      <BaseRadio.Indicator className="radio-dot" />
    </BaseRadio.Root>
  )
}

/** 卡片式单选项：不画圆点，内容由调用方放入。 */
export function RadioGroupCard({ className, id, ...props }: ComponentProps<typeof BaseRadio.Root>) {
  return (
    <BaseRadio.Root
      className={cn("radio-card", className)}
      render={(renderProps, state) => (
        <span
          {...renderProps}
          {...(id === undefined ? {} : { id })}
          data-state={state.checked ? "checked" : "unchecked"}
        />
      )}
      {...props}
    />
  )
}
