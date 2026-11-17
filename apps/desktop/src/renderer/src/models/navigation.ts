// 负责前进后退的历史，保存会话、定时任务、插件、设置与整窗流程的位置。
// 会话按 id、草稿按项目区分，回退时回到原先打开的会话或项目草稿。

/** 在外壳之外整窗渲染的流程。 */
export type FlowName = "login" | "onboarding" | "authorize"

/** 一个可以回去的位置。 */
export type NavLocation =
  | { kind: "draft"; projectId?: string }
  | { kind: "session"; sessionId?: string }
  | { kind: "plugins"; page?: "management" }
  | { kind: "schedules" }
  | { kind: "settings"; page: string }
  | { kind: "flow"; flow: FlowName }

/** 历史记录与当前所在的下标。 */
export type NavHistory = {
  entries: NavLocation[]
  index: number
}

/** 最多保留的历史条数；超出时丢弃最早的。 */
const MAX_ENTRIES = 50

/** 从一个位置开始新的历史。 */
export function createHistory(location: NavLocation): NavHistory {
  return { entries: [location], index: 0 }
}

/** 两个位置是否相同。 */
export function sameLocation(a: NavLocation | null, b: NavLocation | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false
  if (a.kind === "settings" && b.kind === "settings") return a.page === b.page
  if (a.kind === "session" && b.kind === "session") return a.sessionId === b.sessionId
  if (a.kind === "plugins" && b.kind === "plugins") return a.page === b.page
  if (a.kind === "draft" && b.kind === "draft") return a.projectId === b.projectId
  if (a.kind === "flow" && b.kind === "flow") return a.flow === b.flow
  return true
}

/** 当前位置；历史为空时为 null。 */
export function currentLocation(history: NavHistory): NavLocation | null {
  const location = history.entries[history.index]
  if (location?.kind === "settings" && location.page === "plugins") return { kind: "plugins" }
  if (location?.kind === "settings" && location.page === "scheduled-tasks")
    return { kind: "schedules" }
  return location ?? null
}

/** 将已删除会话的位置改为原项目草稿，包括当前自动选中的会话。 */
export function replaceDeletedSessionLocations(
  history: NavHistory,
  deleted: ReadonlyMap<string, string>,
  selected: string | null,
): NavHistory {
  const entries = history.entries.map((item, index): NavLocation => {
    if (item.kind !== "session") return item
    const id = item.sessionId ?? (index === history.index ? selected : null)
    const projectId = id === null ? undefined : deleted.get(id)
    return projectId === undefined ? item : { kind: "draft", projectId }
  })
  return entries.some((item, index) => item !== history.entries[index])
    ? { ...history, entries }
    : history
}

/** 记录一次导航：与当前位置相同时原样返回；否则丢掉前进分支再追加。 */
export function pushLocation(history: NavHistory, location: NavLocation): NavHistory {
  if (sameLocation(currentLocation(history), location)) return history
  const entries = [...history.entries.slice(0, history.index + 1), location].slice(-MAX_ENTRIES)
  return { entries, index: entries.length - 1 }
}

/** 是否还有可后退的位置。 */
export function canGoBack(history: NavHistory): boolean {
  return history.index > 0
}

/** 是否还有可前进的位置。 */
export function canGoForward(history: NavHistory): boolean {
  return history.index >= 0 && history.index < history.entries.length - 1
}

/** 后退一步；已在最早的位置时原样返回。 */
export function goBack(history: NavHistory): NavHistory {
  return canGoBack(history) ? { ...history, index: history.index - 1 } : history
}

/** 前进一步；已在最新的位置时原样返回。 */
export function goForward(history: NavHistory): NavHistory {
  return canGoForward(history) ? { ...history, index: history.index + 1 } : history
}

/** 是否在外壳里显示（会话、设置）；整窗流程不在外壳里。 */
export function inShell(location: NavLocation): boolean {
  return location.kind !== "flow"
}
