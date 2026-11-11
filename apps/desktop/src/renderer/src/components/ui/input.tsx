// 负责单行输入。外观沿用 Pigcode 的 input。
import { Input as BaseInput } from "@pigclaude/pigcode-ui-primitives"
import type { ComponentProps } from "react"

/** 渲染带焦点描边的单行输入框。 */
export function Input({ className, ...props }: ComponentProps<"input">) {
  return <BaseInput className={className} {...props} />
}
