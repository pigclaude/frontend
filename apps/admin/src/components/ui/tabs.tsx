// 负责迁入原后台页面分区与分段标签的版式、键盘和焦点交互。
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"
import { cn } from "@pigclaude/web-ui/lib/utils"

/** Tabs 保持标签页的样式与可访问契约。 */
function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-5", className)}
      {...props}
    />
  )
}

// line：页面级分区（下划线指示条，基线用 inset 阴影画，指示条压在基线上）；
// segmented：小范围的视图切换（胶囊分段）。
const tabsListVariants = cva("group/tabs-list flex items-center text-muted-foreground", {
  variants: {
    variant: {
      line: "w-full gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      segmented: "w-fit gap-0.5 rounded-lg border border-border-soft bg-raise-2 p-[3px]",
    },
  },
  defaultVariants: { variant: "line" },
})

/** TabsList 保持标签页的样式与可访问契约。 */
function TabsList({
  className,
  variant = "line",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

/** TabsTrigger 保持标签页的样式与可访问契约。 */
function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // line
        "group-data-[variant=line]/tabs-list:h-10 group-data-[variant=line]/tabs-list:rounded-t-md group-data-[variant=line]/tabs-list:px-3 group-data-[variant=line]/tabs-list:hover:text-foreground group-data-[variant=line]/tabs-list:data-[state=active]:text-foreground",
        "after:pointer-events-none after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100 group-data-[variant=segmented]/tabs-list:after:hidden",
        // segmented
        "group-data-[variant=segmented]/tabs-list:h-7 group-data-[variant=segmented]/tabs-list:rounded-md group-data-[variant=segmented]/tabs-list:px-3 group-data-[variant=segmented]/tabs-list:hover:text-foreground group-data-[variant=segmented]/tabs-list:data-[state=active]:bg-[var(--seg-active)] group-data-[variant=segmented]/tabs-list:data-[state=active]:text-foreground group-data-[variant=segmented]/tabs-list:data-[state=active]:shadow-[var(--seg-active-shadow)]",
        className,
      )}
      {...props}
    />
  )
}

/** 传 forceMount 时内容常驻（切换不卸载、保留内部状态），非激活面板由 data-state 隐藏。 */
/** TabsContent 保持标签页的样式与可访问契约。 */
function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        "min-w-0 flex-1 outline-none data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-200 data-[state=inactive]:hidden",
        className,
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
