// 负责聊天页线程头的子代理标签：按会话 id 把标签状态记在渲染层内存里（离开聊天页再回来不丢，
// 不写本地存储也不经主进程），并组装成对话组件要的标签栏、只读过程视图和打开、返回的回调。

import { useMemo, useSyncExternalStore } from "react"
import type { ThreadEvent } from "@pigclaude/ui-contracts"
import { collectSubagents, type ChatViewProps } from "@pigclaude/ui-chat"
import {
  closeSubagentTab,
  initialSubagentTabs,
  openSubagentTab,
  selectSubagentTab,
  subagentTabs,
  type SubagentTabState,
} from "../models/subagent-tabs"

const states = new Map<string, SubagentTabState>()
const listeners = new Set<() => void>()
let version = 0

function read(sessionId: string): SubagentTabState {
  return states.get(sessionId) ?? initialSubagentTabs
}

function update(sessionId: string, next: (state: SubagentTabState) => SubagentTabState): void {
  states.set(sessionId, next(read(sessionId)))
  version += 1
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 清空所有会话的标签状态；只给测试在用例之间复位。 */
export function resetSubagentTabs(): void {
  states.clear()
  version += 1
}

/** 聊天页交给对话组件的子代理标签部分。 */
export type SubagentTabProps = Pick<
  ChatViewProps,
  "tabs" | "subagent" | "onOpenSubagent" | "onBackToMain"
>

/**
 * 一个会话的子代理标签。sessionId 为 null（还没有会话）时不提供标签。main 是主会话标签的标题和说明；
 * waiting 是正在等权限回答的子代理。
 */
export function useSubagentTabs(input: {
  sessionId: string | null
  events: ThreadEvent[]
  main: { title: string; description: string }
  waiting: ReadonlySet<string>
}): SubagentTabProps {
  const { sessionId, events, main, waiting } = input
  useSyncExternalStore(subscribe, () => version)
  const subagents = useMemo(() => collectSubagents(events), [events])
  if (sessionId === null) return {}
  const view = subagentTabs({ main, subagents, state: read(sessionId), waiting })
  return {
    tabs: {
      tabs: view.tabs,
      activeId: view.activeId,
      onSelect: (tabId) => update(sessionId, (state) => selectSubagentTab(state, tabId)),
      onClose: (tabId) => update(sessionId, (state) => closeSubagentTab(state, tabId)),
    },
    subagent: view.subagent,
    onOpenSubagent: (id) => update(sessionId, (state) => openSubagentTab(state, id)),
    onBackToMain: () => update(sessionId, (state) => selectSubagentTab(state, "main")),
  }
}
