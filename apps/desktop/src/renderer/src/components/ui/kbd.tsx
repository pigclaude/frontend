// 负责快捷键提示。外观沿用设计稿的 kbd 规则。
import type { ComponentProps } from "react"

/** 渲染一个快捷键标记。 */
export function Kbd(props: ComponentProps<"kbd">) {
  return <kbd {...props} />
}
