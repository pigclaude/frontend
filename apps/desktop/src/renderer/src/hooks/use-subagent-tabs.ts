// 负责聊天页线程头的子代理标签：从标签状态存储读出当前会话的标签状态，组装成对话组件要的标签栏、
// 只读过程视图和打开、返回、关闭的回调。

import { createContext, useContext, useMemo, useSyncExternalStore } from "react"
import type { ThreadEvent } from "@pigclaude/ui-contracts"
import { collectSubagents, type ChatViewProps } from "@pigclaude/ui-chat"
import type { WaitingSubagents } from "../models/session-permissions"
import { SubagentTabStore } from "../models/subagent-tab-store"
import {
  closeSubagentTab,
  mainTab,
  openSubagentTab,
  selectSubagentTab,
  subagentTabBar,
  tabFromId,
} from "../models/subagent-tabs"

/** 标签状态存储；默认是整个渲染进程共用的一份，窗口不关就一直在。 */
export const SubagentTabStoreContext = createContext(new SubagentTabStore())

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
  waiting: WaitingSubagents
}): SubagentTabProps {
  const { sessionId, events, main, waiting } = input
  const store = useContext(SubagentTabStoreContext)
  useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.version(),
  )
  const subagents = useMemo(() => collectSubagents(events), [events])

  if (sessionId === null) return {}
  const bar = subagentTabBar({ main, subagents, state: store.read(sessionId), waiting })
  return {
    tabs: {
      tabs: bar.tabs,
      activeId: bar.activeId,
      onSelect: (id) => store.update(sessionId, (state) => selectSubagentTab(state, tabFromId(id))),
      onClose: (id) => {
        const tab = tabFromId(id)
        if (tab.kind === "subagent") {
          store.update(sessionId, (state) => closeSubagentTab(state, tab.subagentId))
        }
      },
    },
    subagent: bar.subagent,
    onOpenSubagent: (id) => store.update(sessionId, (state) => openSubagentTab(state, id)),
    onBackToMain: () => store.update(sessionId, (state) => selectSubagentTab(state, mainTab)),
  }
}
