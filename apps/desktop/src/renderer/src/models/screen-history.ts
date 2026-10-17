// 负责窗口顶栏后退/前进按钮使用的页面历史。
import type { Screen } from "../screens/screen"

/** 页面历史：entries 按打开顺序排列，index 指向当前页面。 */
export type ScreenHistory = {
  entries: Screen[]
  index: number
}

/** 从一个页面开始新的历史。 */
export function createScreenHistory(screen: Screen): ScreenHistory {
  return { entries: [screen], index: 0 }
}

/** 返回当前页面。 */
export function currentScreen(history: ScreenHistory): Screen {
  return history.entries[history.index] ?? "chat"
}

/** 打开新页面：丢掉当前位置之后的前进记录；重复打开当前页不新增记录。 */
export function pushScreen(history: ScreenHistory, screen: Screen): ScreenHistory {
  if (currentScreen(history) === screen) return history
  const entries = [...history.entries.slice(0, history.index + 1), screen]
  return { entries, index: entries.length - 1 }
}

/** 后退一页；已在最早一页时原样返回。 */
export function goBack(history: ScreenHistory): ScreenHistory {
  return canGoBack(history) ? { ...history, index: history.index - 1 } : history
}

/** 前进一页；已在最新一页时原样返回。 */
export function goForward(history: ScreenHistory): ScreenHistory {
  return canGoForward(history) ? { ...history, index: history.index + 1 } : history
}

/** 是否还有可后退的页面。 */
export function canGoBack(history: ScreenHistory): boolean {
  return history.index > 0
}

/** 是否还有可前进的页面。 */
export function canGoForward(history: ScreenHistory): boolean {
  return history.index < history.entries.length - 1
}
