// 负责迁入 Pigcursor 成熟后台的table组件与交互，保持原有布局和语义。
import * as React from "react"
import { cn } from "@pigclaude/web-ui/lib/utils"

// 后台表格的统一外观集中在这里（表头浅底小字、行 hover、数字等宽），
// 各业务表不再各自维护 TH/TD 样式常量，只按需追加 text-right / font-mono 等差异。
// 用 border-separate + 单元格自带下边框：半透明分隔线在 border-collapse 的格角处会叠加出亮点。
/** compact：抽屉等窄容器里的紧凑密度（单元格 px-3 / py-2）。 */
/** Table 保持后台组件的样式、可访问语义和交互契约。 */
function Table({
  className,
  compact = false,
  ...props
}: React.ComponentProps<"table"> & { compact?: boolean }) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        data-density={compact ? "compact" : undefined}
        className={cn(
          "w-full caption-bottom border-separate border-spacing-0 text-[13px]",
          className,
        )}
        {...props}
      />
    </div>
  )
}

/** TableHeader 保持后台组件的样式、可访问语义和交互契约。 */
function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        "[&_th]:border-b [&_th]:border-border [&_th]:bg-[var(--table-head)] [&_tr]:hover:bg-transparent",
        className,
      )}
      {...props}
    />
  )
}

/** TableBody 保持后台组件的样式、可访问语义和交互契约。 */
function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child>td]:border-b-0", className)}
      {...props}
    />
  )
}

/** TableFooter 保持后台组件的样式、可访问语义和交互契约。 */
function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("bg-raise-1 font-medium [&_td]:border-t [&_td]:border-border", className)}
      {...props}
    />
  )
}

/** TableRow 保持后台组件的样式、可访问语义和交互契约。 */
function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "transition-colors duration-100 hover:bg-raise-1 data-[state=selected]:bg-raise-2",
        className,
      )}
      {...props}
    />
  )
}

/** TableHead 保持后台组件的样式、可访问语义和交互契约。 */
function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-9 px-4 text-left align-middle text-xs font-medium tracking-[0.02em] whitespace-nowrap text-meta first:pl-5 last:pr-5 in-data-[density=compact]:h-8 in-data-[density=compact]:px-3 in-data-[density=compact]:first:pl-3.5 in-data-[density=compact]:last:pr-3.5 [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  )
}

/** TableCell 保持后台组件的样式、可访问语义和交互契约。 */
function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "border-b border-border-soft px-4 py-3 align-middle whitespace-nowrap text-fg-2 first:pl-5 last:pr-5 in-data-[density=compact]:px-3 in-data-[density=compact]:py-2 in-data-[density=compact]:first:pl-3.5 in-data-[density=compact]:last:pr-3.5 [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  )
}

/** TableCaption 保持后台组件的样式、可访问语义和交互契约。 */
function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption }
