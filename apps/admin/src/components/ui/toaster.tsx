// 负责使用原后台的通知图标、语义色与同步明暗主题。
import type { CSSProperties } from "react"
import { CircleCheck, Info, LoaderCircle, OctagonX, TriangleAlert } from "lucide-react"
import { Toaster as Sonner } from "sonner"
import { useIsLightTheme } from "@pigclaude/web-ui/lib/theme"

/** 跟随 <html data-theme> 实时切换明暗（web-ui 版本只在挂载时读一次）。 */
export function Toaster() {
  const isLight = useIsLightTheme()

  return (
    <Sonner
      theme={isLight ? "light" : "dark"}
      position="bottom-right"
      offset={20}
      gap={10}
      icons={{
        success: <CircleCheck className="size-4" />,
        info: <Info className="size-4" />,
        warning: <TriangleAlert className="size-4" />,
        error: <OctagonX className="size-4" />,
        loading: <LoaderCircle className="size-4 animate-spin" />,
      }}
      toastOptions={{
        style: {
          fontSize: 13,
          boxShadow: "var(--menu-shadow)",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "10px",
        } as CSSProperties
      }
    />
  )
}
