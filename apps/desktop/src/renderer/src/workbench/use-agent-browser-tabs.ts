// 按当前会话从主进程读取 Agent 浏览器标签。事件只触发重读，失效的事件和回复不能重新出现旧标签。

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { AgentBrowserTab, WorkbenchBridge } from "../../../workbench-contract"

type SessionTabs = {
  sessionId: string
  tabs: AgentBrowserTab[]
  activeId: string | null
}

/** 只返回当前会话的 Agent 标签，并协调原生视图的显示范围。 */
export function useAgentBrowserTabs(
  bridge: WorkbenchBridge | undefined,
  sessionId: string | null,
  visible: boolean,
  onShow: () => void,
) {
  const [state, setState] = useState<SessionTabs | null>(null)
  const selected = useRef(sessionId)
  selected.current = sessionId
  const show = useRef(onShow)
  show.current = onShow

  useLayoutEffect(() => {
    if (!bridge) return
    const activate = (next: string | null) =>
      void bridge.browserSetActiveSession(next).catch(() => undefined)
    activate(visible ? sessionId : null)
    return () => activate(null)
  }, [bridge, sessionId, visible])

  useEffect(() => {
    if (!bridge || sessionId === null) return
    const scope = sessionId
    const currentBridge = bridge
    let active = true
    let generation = 0
    function refresh(preferred?: string): void {
      const request = ++generation
      void currentBridge
        .browserListAgentTabs(scope)
        .then((listed) => {
          if (!active || request !== generation || selected.current !== scope) return
          const tabs = listed.filter((tab) => tab.sessionId === scope)
          const focus = tabs.some((tab) => tab.id === preferred) ? preferred : undefined
          setState((before) => {
            const previous = before?.sessionId === scope ? before.activeId : undefined
            const activeId =
              focus ??
              (previous === null
                ? null
                : (tabs.find((tab) => tab.id === previous)?.id ?? tabs.at(-1)?.id ?? null))
            return { sessionId: scope, tabs, activeId }
          })
          if (focus !== undefined) show.current()
        })
        .catch(() => undefined)
    }
    const unsubscribe = bridge.subscribe((event) => {
      if (
        (event.type === "browser-open" || event.type === "browser-close") &&
        event.sessionId === sessionId
      )
        refresh(event.type === "browser-open" ? event.id : undefined)
    })
    refresh()
    return () => {
      active = false
      unsubscribe()
    }
  }, [bridge, sessionId])

  const select = useCallback(
    (id: string | null): void => {
      setState((before) => (before?.sessionId === sessionId ? { ...before, activeId: id } : before))
    },
    [sessionId],
  )
  return {
    tabs: state?.sessionId === sessionId ? state.tabs : [],
    activeId: state?.sessionId === sessionId ? state.activeId : null,
    select,
    setTitle(id: string, title: string): void {
      setState((before) =>
        before?.sessionId === sessionId
          ? {
              ...before,
              tabs: before.tabs.map((tab) =>
                tab.id === id ? { ...tab, page: { ...tab.page, title } } : tab,
              ),
            }
          : before,
      )
    },
    close(id: string): void {
      if (sessionId !== null) void bridge?.browserClose(id, sessionId).catch(() => undefined)
    },
  }
}
