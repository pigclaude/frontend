// 负责多行输入。外观沿用设计稿的 textarea，高度随内容。
import type { TextareaHTMLAttributes } from "react"
import { cn } from "../../lib/cn"

/** 渲染无边框的多行输入，供会话输入区使用。 */
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("textarea", className)} {...props} />
}
