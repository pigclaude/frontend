// 负责绘制工作区侧栏、项目树和会话列表。
import { Icon } from "./icon"
import type { ProjectNavigationState } from "../models/navigation-model"
import type { Project } from "../models/project-model"
import type { Screen } from "../screens/screen"

/** 工作区侧栏所需的事件和状态。 */
export type WorkspaceSidebarProps = {
  screen: Screen
  projects: Project[]
  navigation: ProjectNavigationState
  onAddProject: () => void
  onNavigate: (screen: Screen) => void
  onToggleProject: (projectId: string, expanded: boolean) => void
  onNewSession: (projectId?: string) => void
}

/** 绘制工作区导航，不读取会话内核。 */
export function WorkspaceSidebar({
  screen,
  projects,
  navigation,
  onAddProject,
  onNavigate,
  onToggleProject,
  onNewSession,
}: WorkspaceSidebarProps) {
  return (
    <>
      <nav aria-label="主导航">
        <button
          className={screen === "chat-new" ? "nav-item is-active" : "nav-item"}
          type="button"
          onClick={() => onNewSession()}
        >
          <Icon name="pencil" />
          新会话
          <span className="nav-kbd">⌘N</span>
        </button>
        <button className="nav-item" type="button">
          <Icon name="search" />
          搜索
          <span className="nav-kbd">⌘K</span>
        </button>
      </nav>
      <div className="side-label">
        <span>项目</span>
        <button className="icon-btn" type="button" aria-label="排序与筛选" title="排序与筛选">
          <Icon name="filter" small />
        </button>
        <button
          className="icon-btn"
          type="button"
          aria-label="添加项目"
          title="添加项目"
          onClick={onAddProject}
        >
          <Icon name="folder-plus" small />
        </button>
      </div>
      {projects.length === 0 ? (
        <button className="nav-item muted-item" type="button" onClick={onAddProject}>
          <Icon name="plus" />
          添加项目
        </button>
      ) : null}
      {projects.map(({ id, name, sessions }) => {
        const open = navigation.expandedProjects[id] ?? true
        return (
          <div key={id} className="proj-block">
            <div className="proj-row">
              <button
                className="proj"
                type="button"
                aria-expanded={open}
                onClick={() => onToggleProject(id, !open)}
              >
                <span className="proj-icon">
                  <Icon name="folder" className="proj-folder" />
                  <Icon name={open ? "down" : "right"} small className="proj-caret" />
                </span>
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
            {open ? (
              <div className="proj-sessions">
                {sessions.length === 0 ? <p className="side-empty">还没有会话</p> : null}
                {sessions.map(({ id, title, time, live }) => (
                  <button
                    key={id}
                    className={screen === "chat" && id === "s-daemon" ? "sess is-active" : "sess"}
                    type="button"
                    aria-current={screen === "chat" && id === "s-daemon" ? "page" : undefined}
                    onClick={() => onNavigate("chat")}
                  >
                    <span className={live ? "sess-dot live" : "sess-dot"} />
                    <span className="truncate">{title}</span>
                    <time>{live ? "回复中" : time}</time>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
    </>
  )
}
