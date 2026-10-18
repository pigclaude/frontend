// 负责沿用 Pigcursor 的主题恢复与切换语义，并提供服务端可读取的首帧脚本。
const THEME_KEY = "pigclaude-theme"

/** 恢复持久化主题：仅 light 设置属性，其余值使用默认暗色。 */
export function initTheme(): void {
  try {
    if (localStorage.getItem(THEME_KEY) === "light") {
      document.documentElement.dataset.theme = "light"
    } else {
      delete document.documentElement.dataset.theme
    }
  } catch {
    // 存储不可用时保持页面默认主题。
  }
}

/** 切换 HTML 主题属性；存储受限时仍保证当前页面完成切换。 */
export function toggleTheme(): void {
  const isLight = document.documentElement.dataset.theme === "light"
  if (isLight) {
    delete document.documentElement.dataset.theme
  } else {
    document.documentElement.dataset.theme = "light"
  }
  try {
    localStorage.setItem(THEME_KEY, isLight ? "dark" : "light")
  } catch {
    // 存储不可用时只更新 DOM，避免阻断用户操作。
  }
}

/** 公开无 React 依赖的首帧脚本，供服务端页面布局读取。 */
export { themeInitializationScript } from "./theme-initialization"

/** 共享客户端订阅接口，同时允许服务端读取同模块的初始化脚本。 */
export { useIsLightTheme } from "./theme-hook"
