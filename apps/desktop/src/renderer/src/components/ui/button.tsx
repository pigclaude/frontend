// 负责桌面按钮。外观沿用 Pigcode 的 btn，底层使用 Base UI useRender。
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps, ReactElement } from "react"
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

/** 渲染设计稿里的按钮；asChild 用 Base UI render 替换默认 button。 */
export function Button({
  className,
  variant,
  size,
  asChild = false,
  children,
  ...props
}: ButtonProps) {
  return useRender({
    render: asChild ? (children as ReactElement) : undefined,
    defaultTagName: "button",
    props: {
      ...props,
      children: asChild ? undefined : children,
      className: cn(buttonVariants({ variant, size }), className),
    },
  })
}
