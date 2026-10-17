// 负责单行输入。外观沿用设计稿的 input。
import type { InputHTMLAttributes } from "react"
import { cn } from "../../lib/cn"

/** 渲染带焦点描边的单行输入框。 */
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("input", className)} {...props} />
}
