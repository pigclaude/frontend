// 负责滑块。底层是 shadcn 用的 Radix Slider，轨道和圆钮样式来自设计稿 token。
import * as SliderPrimitive from "@radix-ui/react-slider"
import type { ComponentProps } from "react"
import { cn } from "../../lib/cn"

/** 渲染单滑块或区间滑块，每个取值对应一个圆钮；aria-label 落在圆钮上供读屏器读出；多圆钮时用 thumbLabels 给每个圆钮单独命名，缺省回退到 aria-label。 */
export function Slider({
  className,
  value,
  defaultValue,
  "aria-label": ariaLabel,
  thumbLabels,
  ...props
}: ComponentProps<typeof SliderPrimitive.Root> & { thumbLabels?: string[] }) {
  const thumbs = value ?? defaultValue ?? [0]
  return (
    <SliderPrimitive.Root
      className={cn("slider", className)}
      value={value}
      defaultValue={defaultValue}
      {...props}
    >
      <SliderPrimitive.Track className="slider-track">
        <SliderPrimitive.Range className="slider-range" />
      </SliderPrimitive.Track>
      {thumbs.map((_, index) => (
        <SliderPrimitive.Thumb
          key={index}
          className="slider-thumb"
          aria-label={thumbLabels?.[index] ?? ariaLabel}
        />
      ))}
    </SliderPrimitive.Root>
  )
}
