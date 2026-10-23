// 提供后台优惠方式的 Radix 单选切换组。
import * as React from "react"
import { ToggleGroup as Primitive } from "radix-ui"
/** 切换组保留方向键和按压语义。 */
export function ToggleGroup(props: React.ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root className="flex gap-1" {...props} />
}
/** 切换按钮使用后台边框和选中态。 */
export function ToggleGroupItem(props: React.ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item className="rounded-md border px-3 py-2 data-[state=on]:bg-accent" {...props} />
  )
}
