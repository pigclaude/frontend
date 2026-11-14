// 负责线程头子代理标签的状态和标签栏：选中哪个标签、用户关掉了哪些子代理、从时间线的子代理卡
// 打开过哪些子代理，以及据此列出的标签、选中的标签和要显示的只读过程。纯函数，状态只在渲染层内存里。

import type { SubagentCall, ThreadTab } from "@pigclaude/ui-chat"

/** 一个会话的标签状态。selected 是标签 id：主会话为 main，子代理为 spawned:<工具调用 id>。 */
export type SubagentTabState = {
  selected: string
  dismissed: ReadonlySet<string>
  opened: ReadonlySet<string>
}

/** 还没有操作过标签的会话：选中主会话。 */
export const initialSubagentTabs: SubagentTabState = {
  selected: "main",
  dismissed: new Set(),
  opened: new Set(),
}

const prefix = "spawned:"

/** 标签栏、选中的标签和要显示的子代理；选中主会话时 subagent 为 null。 */
export type SubagentTabsView = {
  tabs: ThreadTab[]
  activeId: string
  subagent: SubagentCall | null
}

/** 选中一个标签。 */
export function selectSubagentTab(state: SubagentTabState, tabId: string): SubagentTabState {
  return { ...state, selected: tabId }
}

/** 从子代理卡打开它的标签并选中；之前关掉过也重新显示。 */
export function openSubagentTab(state: SubagentTabState, subagentId: string): SubagentTabState {
  const dismissed = new Set(state.dismissed)
  dismissed.delete(subagentId)
  return {
    selected: `${prefix}${subagentId}`,
    dismissed,
    opened: new Set([...state.opened, subagentId]),
  }
}

/** 关掉一个子代理标签；正在看它时回到主会话。主会话的标签关不掉。 */
export function closeSubagentTab(state: SubagentTabState, tabId: string): SubagentTabState {
  if (!tabId.startsWith(prefix)) return state
  const subagentId = tabId.slice(prefix.length)
  const opened = new Set(state.opened)
  opened.delete(subagentId)
  return {
    selected: state.selected === tabId ? "main" : state.selected,
    dismissed: new Set([...state.dismissed, subagentId]),
    opened,
  }
}

/**
 * 组装标签栏：主会话，加上最近一次派生过子代理的那一轮里的全部子代理和从卡片打开过的子代理，
 * 用户关掉的不显示。waiting 是正在等权限回答的子代理（父工具调用 id）。选中的标签不在栏里时回到主会话。
 */
export function subagentTabs(input: {
  main: { title: string; description: string }
  subagents: ReadonlyMap<string, SubagentCall>
  state: SubagentTabState
  waiting: ReadonlySet<string>
}): SubagentTabsView {
  const { main, subagents, state, waiting } = input
  const all = [...subagents.values()]
  const latestRun = all.at(-1)?.runId ?? null
  const shown = all.filter(
    (subagent) =>
      !state.dismissed.has(subagent.id) &&
      ((latestRun !== null && subagent.runId === latestRun) || state.opened.has(subagent.id)),
  )
  const tabs: ThreadTab[] = [
    { id: "main", kind: "main", ...main },
    ...shown.map((subagent): ThreadTab => ({
      id: `${prefix}${subagent.id}`,
      kind: "spawned",
      title: subagent.description ?? subagent.name,
      description: subagent.description
        ? `${subagent.name} · ${subagent.description}`
        : subagent.name,
      running: subagent.status === "running",
      waiting: subagent.status === "running" && waiting.has(subagent.id),
      closable: true,
    })),
  ]
  const subagent = shown.find((item) => `${prefix}${item.id}` === state.selected) ?? null
  return { tabs, activeId: subagent === null ? "main" : state.selected, subagent }
}
