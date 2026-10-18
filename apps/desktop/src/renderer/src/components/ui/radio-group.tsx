// 负责单选组。底层是 shadcn 用的 Radix RadioGroup，圆点样式来自设计稿 token。
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"
import type { ComponentProps } from "react"
import { cn } from "../../lib/cn"

/** 一组互斥的单选项。 */
export function RadioGroup({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root className={cn("radio-group", className)} {...props} />
}

/** 单选组里的一项，选中时显示实心圆点。 */
export function RadioGroupItem({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item className={cn("radio", className)} {...props}>
      <RadioGroupPrimitive.Indicator className="radio-dot" />
    </RadioGroupPrimitive.Item>
  )
}

/** 卡片式单选项：不画圆点，内容由调用方放入，选中态由 data-state=checked 表示。 */
export function RadioGroupCard({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return <RadioGroupPrimitive.Item className={cn("radio-card", className)} {...props} />
}
