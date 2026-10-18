// 负责迁入 Pigcursor 成熟后台的button组件与交互，保持原有布局和语义。
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { cn } from "@pigclaude/web-ui/lib/utils"

// 后台按钮：比官网更紧凑（默认 32px），主按钮带内高光，描边按钮随主题取 --btn-bg。
// 新增 danger 变体（描边红字）专供表格行内的「删除 / 撤销 / 解绑 / 禁用」，
// 与需要二次确认的实心 destructive 区分开。
const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md text-[13px] font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,opacity] duration-150 outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.16),0_1px_2px_rgb(0_0_0/0.22)] hover:bg-[var(--btn-primary-hover)] active:bg-[var(--btn-primary-active)]",
        destructive:
          "bg-[var(--danger)] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(0_0_0/0.22)] hover:bg-[color-mix(in_oklab,var(--danger),black_12%)] focus-visible:ring-[color-mix(in_oklab,var(--danger),transparent_60%)]",
        outline:
          "border border-border bg-[var(--btn-bg)] text-foreground shadow-[var(--btn-shadow)] hover:border-border-strong hover:bg-[var(--btn-bg-hover)]",
        secondary: "bg-raise-2 text-foreground hover:bg-raise-3",
        ghost: "text-fg-2 hover:bg-raise-2 hover:text-foreground",
        danger:
          "border border-[color-mix(in_oklab,var(--danger),transparent_68%)] text-danger-ink hover:border-[color-mix(in_oklab,var(--danger),transparent_45%)] hover:bg-[color-mix(in_oklab,var(--danger),transparent_90%)] focus-visible:ring-[color-mix(in_oklab,var(--danger),transparent_60%)]",
        link: "h-auto! px-0! text-accent-ink underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3",
        xs: "h-6 gap-1 rounded-[5px] px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 px-4 text-sm",
        icon: "size-8",
        "icon-xs": "size-6 rounded-[5px] [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

/** Button 保持后台组件的样式、可访问语义和交互契约。 */
function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
