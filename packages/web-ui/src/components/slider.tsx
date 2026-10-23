// 负责提供 shadcn 风格的 Radix 滑块，保留键盘和读屏数值语义。
"use client"
import type { ComponentProps } from "react"
import { Slider as Primitive } from "radix-ui"
import { cn } from "../lib/utils"

/** 提供受控滑块和可聚焦拇指，不裸露原生 range 控件。 */
export function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  "aria-label": label,
  ...props
}: ComponentProps<typeof Primitive.Root>) {
  const values = value ?? defaultValue ?? [min]
  return (
    <Primitive.Root
      data-slot="slider"
      value={value}
      defaultValue={defaultValue}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=horizontal]:h-5 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
        className,
      )}
      {...props}
    >
      <Primitive.Track
        data-slot="slider-track"
        className="relative grow overflow-hidden rounded-full bg-muted data-[orientation=horizontal]:h-1.5 data-[orientation=vertical]:w-1.5"
      >
        <Primitive.Range
          data-slot="slider-range"
          className="absolute bg-primary data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
        />
      </Primitive.Track>
      {values.map((_, index) => (
        <Primitive.Thumb
          key={index}
          data-slot="slider-thumb"
          aria-label={label}
          className="block size-4 shrink-0 rounded-full border border-primary bg-background shadow-sm outline-none focus-visible:ring-4 focus-visible:ring-ring/40 disabled:pointer-events-none"
        />
      ))}
    </Primitive.Root>
  )
}
