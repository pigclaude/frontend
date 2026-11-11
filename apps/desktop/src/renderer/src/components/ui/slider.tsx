// 负责滑块。底层使用 Base UI Slider，轨道和圆钮样式来自 Pigcode token。
import { Slider as BaseSlider } from "@base-ui/react/slider"
import type { ComponentProps } from "react"
import { cn } from "../../lib/cn"

type SliderProps = Omit<
  ComponentProps<typeof BaseSlider.Root>,
  "value" | "defaultValue" | "onValueChange"
> & {
  value?: readonly number[] | undefined
  defaultValue?: readonly number[] | undefined
  onValueChange?: ((value: readonly number[]) => void) | undefined
  thumbLabels?: string[] | undefined
}

/** 渲染单滑块或区间滑块，每个取值对应一个圆钮。 */
export function Slider({
  className,
  value,
  defaultValue,
  onValueChange,
  "aria-label": ariaLabel,
  thumbLabels,
  ...props
}: SliderProps) {
  const thumbs = [...(value ?? defaultValue ?? [0])]
  return (
    <BaseSlider.Root<readonly number[]>
      className={cn("slider", className)}
      {...(value === undefined ? {} : { value })}
      {...(defaultValue === undefined ? {} : { defaultValue })}
      {...(onValueChange === undefined ? {} : { onValueChange })}
      {...props}
    >
      <BaseSlider.Control className="slider-control">
        <BaseSlider.Track className="slider-track">
          <BaseSlider.Indicator className="slider-range" />
        </BaseSlider.Track>
        {thumbs.map((_, index) => (
          <BaseSlider.Thumb
            key={index}
            className="slider-thumb"
            aria-label={thumbLabels?.[index] ?? ariaLabel}
          />
        ))}
      </BaseSlider.Control>
    </BaseSlider.Root>
  )
}
