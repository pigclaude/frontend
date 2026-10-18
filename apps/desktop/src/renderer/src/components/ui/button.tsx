// 负责桌面按钮。外观沿用设计稿的 btn，底层是 shadcn 的 Slot 和变体。
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"
import { cn } from "../../lib/cn"

const buttonVariants = cva("", {
  variants: {
    variant: {
      primary: "btn btn-primary",
      secondary: "btn btn-secondary",
      ghost: "btn btn-ghost",
      danger: "btn btn-danger",
      solidDanger: "btn btn-solid-danger",
      plain: "",
    },
    size: {
      sm: "btn-sm",
      md: "",
      lg: "btn-lg",
      block: "btn-block btn-lg",
      icon: "btn-icon",
    },
  },
  defaultVariants: { variant: "secondary", size: "md" },
})

type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }

/** 渲染设计稿里的按钮，可换成链接等子元素。ref 和其余属性原样落到按钮上，可作 Radix asChild 触发器。 */
export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button"
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
