// 负责迁入 Pigcursor 成熟后台的theme-button组件与交互，保持原有布局和语义。
import { Moon, Sun } from "lucide-react"
import { cn } from "@pigclaude/web-ui/lib/utils"
import { Button } from "@/components/ui/button"
import { toggleTheme, useIsLightTheme } from "@pigclaude/web-ui/lib/theme"

interface ThemeButtonProps {
  className?: string
}

/**
 * 主题切换图标按钮：AdminShell 顶栏与登录页固定右上角共用此实现，
 * 仅通过 `className` 覆盖定位差异（登录页额外传 `fixed top-... right-...`）。
 */
/** ThemeButton 保持后台组件的样式、可访问语义和交互契约。 */
export function ThemeButton({ className }: ThemeButtonProps) {
  const isLight = useIsLightTheme()

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="切换主题"
      title={isLight ? "切换到暗色" : "切换到亮色"}
      onClick={toggleTheme}
      className={cn("text-muted-foreground", className)}
    >
      {isLight ? <Sun className="size-[15px]" /> : <Moon className="size-[15px]" />}
    </Button>
  )
}
