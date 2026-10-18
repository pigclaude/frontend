// 负责迁入 Pigcursor 成熟后台的input组件与交互，保持原有布局和语义。
import * as React from "react"
import { Search } from "lucide-react"
import { cn } from "@pigclaude/web-ui/lib/utils"

/** 输入类控件共用的外观：边框/底色随主题，聚焦为强调色描边 + 3px 柔光环，aria-invalid 转红。 */
export const fieldClass =
  "w-full min-w-0 rounded-md border border-[var(--field-border)] bg-[var(--input-bg)] text-[13px] text-foreground shadow-[var(--btn-shadow)] transition-[border-color,box-shadow,background-color] duration-150 outline-none placeholder:text-meta hover:border-border-strong focus-visible:border-[var(--accent)] focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[var(--danger)] aria-invalid:ring-[3px] aria-invalid:ring-[color-mix(in_oklab,var(--danger),transparent_82%)]"

/** Input 保持后台组件的样式、可访问语义和交互契约。 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldClass,
        "h-8 px-2.5 py-1 file:mr-2 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-foreground",
        className,
      )}
      {...props}
    />
  )
}

/** 带前置放大镜图标的搜索框；宽度由外层 wrapper 控制（className 作用于 input 本身）。 */
/** SearchInput 保持后台组件的样式、可访问语义和交互契约。 */
function SearchInput({
  className,
  wrapperClassName,
  ...props
}: React.ComponentProps<"input"> & { wrapperClassName?: string }) {
  return (
    <div data-slot="search-input" className={cn("relative w-full min-w-0", wrapperClassName)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-meta" />
      <Input type="search" className={cn("pl-8", className)} {...props} />
    </div>
  )
}

export { Input, SearchInput }
