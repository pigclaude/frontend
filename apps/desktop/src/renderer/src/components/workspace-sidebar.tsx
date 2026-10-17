// 负责绘制工作区侧栏、项目树和会话列表。
import { useState } from "react"
import { Icon } from "./icon"
import type { ProjectNavigationState } from "../models/navigation-model"
import type { Screen } from "../screens/screen"

const projects: Array<[string, Array<[string, string, string, boolean]>]> = [
  [
    "frontend",
    [
      ["s-daemon", "流开始后不再换号", "刚刚", true],
      ["s-tz", "补 session-env 时区测试", "1小时", false],
      ["s-gate", "login-gate 出口核对", "昨天", false],
    ],
  ],
  ["permission-api", [["s-axum", "axum 0.8 State 改写", "昨天", false]]],
  ["cchelper", []],
]

/** 工作区侧栏所需的事件和状态。 */
export type WorkspaceSidebarProps = {
  screen: Screen
  navigation: ProjectNavigationState
  onNavigate: (screen: Screen) => void
  onToggleProject: (projectId: string, expanded: boolean) => void
  onNewSession: (projectId?: string) => void
}

/** 绘制工作区导航，不读取会话内核。 */
export function WorkspaceSidebar({
  screen,
  navigation,
  onNavigate,
  onToggleProject,
  onNewSession,
}: WorkspaceSidebarProps) {
  const [noticeVisible, setNoticeVisible] = useState(true)
  return (
    <>
      <nav aria-label="主导航">
        <button
          className={screen === "chat-new" ? "nav-item is-active" : "nav-item"}
          type="button"
          onClick={() => onNewSession()}
        >
          <Icon name="plus" />
          新会话
          <span className="nav-kbd">⌘ N</span>
        </button>
        <button className="nav-item" type="button">
          <Icon name="search" />
          搜索
          <span className="nav-kbd">⌘ K</span>
        </button>
      </nav>
      <div className="side-label">
        <span>项目</span>
        <button className="icon-btn" type="button" aria-label="排序与筛选">
          <Icon name="filter" small />
        </button>
      </div>
      {projects.map(([name, sessions]) => {
        const open = navigation.expandedProjects[name] ?? true
        return (
          <div key={name} className="proj-block">
            <div className="proj-row">
              <button
                className="proj"
                type="button"
                aria-expanded={open}
                onClick={() => onToggleProject(name, !open)}
              >
                <Icon name={open ? "down" : "right"} small />
                <Icon name="folder" />
                <span className="truncate">{name}</span>
              </button>
              <button
                className="icon-btn proj-add"
                type="button"
                aria-label={`在 ${name} 新建会话`}
                onClick={() => onNewSession(name)}
              >
                <Icon name="plus" small />
              </button>
            </div>
            {open
              ? sessions.map(([id, title, time, live]) => (
                  <button
                    key={id}
                    className={screen === "chat" && id === "s-daemon" ? "sess is-active" : "sess"}
                    type="button"
                    onClick={() => onNavigate("chat")}
                  >
                    <span className={live ? "sess-dot live" : "sess-dot"} />
                    <span className="truncate">{title}</span>
                    <time>{time}</time>
                  </button>
                ))
              : null}
          </div>
        )
      })}
      {noticeVisible ? (
        <button className="side-notice" type="button" onClick={() => onNavigate("accounts")}>
          <span className="dot warn" />
          <span className="grow">旧号 Pro 需要重新授权</span>
          <Icon name="right" small />
        </button>
      ) : null}
      {!noticeVisible ? null : (
        <button className="sr-only" type="button" onClick={() => setNoticeVisible(false)}>
          隐藏提醒
        </button>
      )}
    </>
  )
}
