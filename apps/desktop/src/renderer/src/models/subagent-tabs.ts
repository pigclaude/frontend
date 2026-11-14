// 负责线程头子代理标签的状态和标签栏：选中哪个标签、用户关掉了哪些子代理、从时间线的子代理卡
// 打开过哪些子代理，以及据此组装的标签栏、选中的标签和要显示的只读过程。纯函数。

import type { SubagentCall, ThreadTab } from "@pigclaude/ui-chat"
import type { WaitingSubagents } from "./session-permissions"

/** 线程头的一个标签：主会话，或者一个子代理（按派生它的 Agent 工具调用 id）。 */
export type SubagentTab = { kind: "main" } | { kind: "subagent"; subagentId: string }

/** 主会话的标签。 */
export const mainTab: SubagentTab = { kind: "main" }

/** 一个会话的标签状态。 */
export type SubagentTabState = {
  selected: SubagentTab
  dismissed: ReadonlySet<string>
  opened: ReadonlySet<string>
}

/** 还没有操作过标签的会话：选中主会话。 */
export const initialSubagentTabs: SubagentTabState = {
  selected: mainTab,
  dismissed: new Set(),
  opened: new Set(),
}

/** 组装好的标签栏：交给对话组件的标签、选中标签的 id，以及要显示只读过程的子代理。 */
export type SubagentTabBar = {
  tabs: ThreadTab[]
  activeId: string
  subagent: SubagentCall | null
}

const subagentPrefix = "spawned:"

/** 对话组件标签栏里的标签 id；和 tabFromId 互逆。 */
export function tabId(tab: SubagentTab): string {
  return tab.kind === "main" ? "main" : `${subagentPrefix}${tab.subagentId}`
}

/** 把对话组件标签栏里的标签 id 读回标签；认不出的 id 是主会话。 */
export function tabFromId(id: string): SubagentTab {
  return id.startsWith(subagentPrefix)
    ? { kind: "subagent", subagentId: id.slice(subagentPrefix.length) }
    : mainTab
}

/** 选中一个标签。 */
export function selectSubagentTab(state: SubagentTabState, tab: SubagentTab): SubagentTabState {
  return { ...state, selected: tab }
}

/** 从子代理卡打开它的标签并选中；之前关掉过也重新显示。 */
export function openSubagentTab(state: SubagentTabState, subagentId: string): SubagentTabState {
  const dismissed = new Set(state.dismissed)
  dismissed.delete(subagentId)
  return {
    selected: { kind: "subagent", subagentId },
    dismissed,
    opened: new Set([...state.opened, subagentId]),
  }
}

/** 关掉一个子代理的标签；正在看它时回到主会话。 */
export function closeSubagentTab(state: SubagentTabState, subagentId: string): SubagentTabState {
  const opened = new Set(state.opened)
  opened.delete(subagentId)
  const viewing = state.selected.kind === "subagent" && state.selected.subagentId === subagentId
  return {
    selected: viewing ? mainTab : state.selected,
    dismissed: new Set([...state.dismissed, subagentId]),
    opened,
  }
}

/**
 * 组装标签栏：主会话，加上最近一次派生过子代理的那一轮里的全部子代理和从卡片打开过的子代理，
 * 用户关掉的不显示。运行中的子代理在等权限回答时显示等待；认不出是哪个子代理的请求，让所有运行中
 * 的子代理都显示等待。选中的子代理不在栏里时回到主会话。
 */
export function subagentTabBar(input: {
  main: { title: string; description: string }
  subagents: ReadonlyMap<string, SubagentCall>
  state: SubagentTabState
  waiting: WaitingSubagents
}): SubagentTabBar {
  const { main, subagents, state, waiting } = input
  const all = [...subagents.values()]
  const latestRun = all.at(-1)?.runId ?? null
  const shown = all.filter(
    (subagent) =>
      !state.dismissed.has(subagent.id) &&
      ((latestRun !== null && subagent.runId === latestRun) || state.opened.has(subagent.id)),
  )
  const tabs: ThreadTab[] = [
    { id: tabId(mainTab), kind: "main", ...main },
    ...shown.map((subagent): ThreadTab => {
      const running = subagent.status === "running"
      return {
        id: tabId({ kind: "subagent", subagentId: subagent.id }),
        kind: "spawned",
        title: subagent.description ?? subagent.name,
        description: subagent.description
          ? `${subagent.name} · ${subagent.description}`
          : subagent.name,
        running,
        waiting: running && (waiting.parents.has(subagent.id) || waiting.unplaced),
        closable: true,
      }
    }),
  ]
  const { selected } = state
  const subagent =
    selected.kind === "subagent"
      ? (shown.find((item) => item.id === selected.subagentId) ?? null)
      : null
  return { tabs, activeId: tabId(subagent === null ? mainTab : selected), subagent }
}
