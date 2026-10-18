// 负责迁入 Pigcursor 成熟后台的badge组件与交互，保持原有布局和语义。
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { cn } from "@pigclaude/web-ui/lib/utils"

// Tailwind 只识别字面量类名，四种色调的底色/描边必须逐个写出，不能用模板拼接。
const ACCENT =
  "border-[color-mix(in_oklab,var(--accent),transparent_66%)] bg-[color-mix(in_oklab,var(--accent),transparent_88%)] text-accent-ink"
const SUCCESS =
  "border-[color-mix(in_oklab,var(--success),transparent_66%)] bg-[color-mix(in_oklab,var(--success),transparent_89%)] text-success-ink"
const WARN =
  "border-[color-mix(in_oklab,var(--warn),transparent_62%)] bg-[color-mix(in_oklab,var(--warn),transparent_89%)] text-warn-ink"
const DANGER =
  "border-[color-mix(in_oklab,var(--danger),transparent_64%)] bg-[color-mix(in_oklab,var(--danger),transparent_89%)] text-danger-ink"

// 语义徽章：柔和底色 + 同色描边 + ink 文字（暗/亮主题各自取 ink 色保证对比度）。
// 兼容 shadcn 变体名（secondary/destructive/outline），同时直接接受业务里通用的
// tone 名（default/neutral/accent/success/warn/danger，其中 default 与各页 Tone 表一致=中性），
// 各页面的 Tone 映射表可原样传入。
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-2 py-px text-[11.5px] leading-[18px] font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-border bg-raise-2 text-fg-2",
        accent: ACCENT,
        success: SUCCESS,
        warn: WARN,
        danger: DANGER,
        destructive: DANGER,
        neutral: "border-border bg-raise-2 text-fg-2",
        secondary: "border-border bg-raise-2 text-fg-2",
        outline: "border-border text-fg-2",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
)

/** 徽章支持的后台语义状态颜色。 */
type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>

/** Badge 保持后台组件的样式、可访问语义和交互契约。 */
function Badge({
  className,
  variant = "neutral",
  dot = false,
  asChild = false,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean; dot?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"
  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      {dot && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </Comp>
  )
}

export { Badge, badgeVariants, type BadgeVariant }
