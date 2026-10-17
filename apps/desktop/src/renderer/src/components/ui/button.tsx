// 负责桌面按钮。外观沿用设计稿的 btn，底层是 shadcn 的 Slot 和变体。
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import type { ButtonHTMLAttributes } from "react"
import { cn } from "../../lib/cn"

const buttonVariants = cva("btn", {
  variants: {
    variant: {
      primary: "btn-primary",
      secondary: "btn-secondary",
      ghost: "btn-ghost",
      danger: "btn-danger",
      solidDanger: "btn-solid-danger",
    },
    size: {
      sm: "btn-sm",
      md: "",
      lg: "btn-lg",
      block: "btn-block btn-lg",
    },
  },
  defaultVariants: { variant: "secondary", size: "md" },
})

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }

/** 渲染设计稿里的按钮，可换成链接等子元素。 */
export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button"
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
