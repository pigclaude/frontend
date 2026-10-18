// 负责订阅 HTML 主题属性，使按钮和菜单的主题图标始终同步。
"use client"

import { useSyncExternalStore } from "react"

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  })
  return () => observer.disconnect()
}

/** 订阅页面主题，服务端渲染与 hydration 的首个快照使用默认暗色。 */
export function useIsLightTheme(): boolean {
  return useSyncExternalStore(
    subscribeTheme,
    () => document.documentElement.dataset.theme === "light",
    () => false,
  )
}
