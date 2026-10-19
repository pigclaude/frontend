// 负责沿用 Pigcursor 圆形主题按钮，并连接共享首帧主题状态。
"use client"

import { Moon, Sun } from "lucide-react"
import { Button } from "@pigclaude/web-ui/components/button"
import { toggleTheme, useIsLightTheme } from "@pigclaude/web-ui/lib/theme"

/** 切换全站浅色与深色，并保留明确的键盘和读屏入口。 */
export function ThemeToggle() {
  const isLight = useIsLightTheme()
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="切换主题"
      title="切换主题"
      onClick={toggleTheme}
      className="size-[30px] rounded-full border border-border bg-[var(--raise-1)] text-foreground hover:bg-[var(--raise-3)] hover:text-foreground dark:hover:bg-[var(--raise-3)]"
    >
      {isLight ? <Sun className="size-[15px]" /> : <Moon className="size-[15px]" />}
    </Button>
  )
}
