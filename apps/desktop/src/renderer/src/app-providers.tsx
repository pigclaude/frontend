// 负责整窗共用的上下文：界面语言、提示气泡、窗口底部短提示和扩展点注册表。
// 外壳、设置页和整窗流程都在它下面渲染，拷入的 Pigcode 组件在任何一屏都能读到语言和注册表。
import { useState, type ReactNode } from "react"
import { ExtensionRegistryScope, createExtensionRegistry } from "@pigclaude/client-runtime"
import { LocaleProvider, Tooltip, type Locale } from "@pigclaude/ui-primitives"
import { ToastProvider } from "@pigclaude/ui-shell"

/** 桌面端目前只交付简体中文；英文词典键已齐全，界面语言设置接入后从这里切换。 */
export const desktopLocale: Locale = "zh-CN"

/** 提供整窗共用的上下文；注册表在应用存续期间只建一次。 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [registry] = useState(createExtensionRegistry)
  return (
    <LocaleProvider locale={desktopLocale}>
      <ExtensionRegistryScope registry={registry}>
        <Tooltip.Provider>
          <ToastProvider>{children}</ToastProvider>
        </Tooltip.Provider>
      </ExtensionRegistryScope>
    </LocaleProvider>
  )
}
