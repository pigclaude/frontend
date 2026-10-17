// 负责窗口外壳：固定在左上角的窗口按钮、工作区侧栏、设置侧栏、提醒和当前用户菜单。
import { useState, type ReactNode } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"
import { Icon } from "./icon"
import { TrafficLights } from "./traffic-lights"
import { SettingsSidebar } from "./settings-sidebar"
import { WorkspaceSidebar } from "./workspace-sidebar"
import type { ProjectNavigationState } from "../models/navigation-model"
import type { Project } from "../models/project-model"
import { settingsScreens } from "../models/settings-nav"
import type { ResolvedTheme } from "../models/theme-model"
import type { Screen } from "../screens/screen"

/** 侧栏需要的状态与事件。 */
export type SidebarProps = {
  screen: Screen
  projects: Project[]
  navigation: ProjectNavigationState
  onAddProject: () => void
  onNavigate: (screen: Screen) => void
  onExitSettings: () => void
  onToggleProject: (projectId: string, expanded: boolean) => void
  onNewSession: (projectId?: string) => void
  onLogout: () => void
  theme: ResolvedTheme
  onToggleTheme: () => void
}

/** 按当前页面切换工作区侧栏和设置侧栏。顶部留出窗口按钮的位置。 */
export function Sidebar({
  screen,
  projects,
  navigation,
  onAddProject,
  onNavigate,
  onExitSettings,
  onToggleProject,
  onNewSession,
  onLogout,
  theme,
  onToggleTheme,
}: SidebarProps) {
  const inSettings = settingsScreens.has(screen)
  const [noticeVisible, setNoticeVisible] = useState(true)
  return (
    <aside className="sidebar" aria-label={inSettings ? "设置导航" : "侧栏"}>
      <div className="side-top" />
      <div className="side-scroll">
        {inSettings ? (
          <SettingsSidebar screen={screen} onNavigate={onNavigate} onExit={onExitSettings} />
        ) : (
          <WorkspaceSidebar
            screen={screen}
            projects={projects}
            navigation={navigation}
            onAddProject={onAddProject}
            onNavigate={onNavigate}
            onToggleProject={onToggleProject}
            onNewSession={onNewSession}
          />
        )}
      </div>
      {!inSettings && noticeVisible ? (
        <div className="side-notice">
          <button className="side-notice-main" type="button" onClick={() => onNavigate("accounts")}>
            <span className="dot warn" />
            <span className="grow">
              <span className="side-notice-title">旧号 Pro 需要重新授权</span>
              <span className="side-notice-desc">已暂停参与自动切换</span>
            </span>
          </button>
          <button
            className="icon-btn side-notice-close"
            type="button"
            aria-label="隐藏提醒"
            onClick={() => setNoticeVisible(false)}
          >
            <Icon name="x" small />
          </button>
        </div>
      ) : null}
      <div className="side-foot">
        <DropdownMenu>
          <DropdownMenuTrigger className="acct-switch">
            <span className="avatar">林</span>
            <span className="who truncate">林舟</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="menu-wide">
            <div className="menu-user">
              <span className="avatar">林</span>
              <span className="grow">
                <span className="menu-user-name">林舟</span>
                <span className="menu-user-mail">lin•••@example.com</span>
              </span>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onNavigate("profile")}>
              <Icon name="user" />
              我的账户
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onNavigate("accounts")}>
              <Icon name="users" />
              Claude 账号
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onNavigate("general")}>
              <Icon name="gear" />
              设置
              <span className="end">⌘,</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onToggleTheme}>
              <Icon name={theme === "light" ? "moon" : "sun"} />
              {theme === "light" ? "切换深色" : "切换浅色"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onLogout}>
              <Icon name="exit" />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          className={inSettings ? "icon-btn foot-gear is-active" : "icon-btn foot-gear"}
          type="button"
          aria-label="设置"
          aria-pressed={inSettings}
          onClick={() => (inSettings ? onExitSettings() : onNavigate("general"))}
        >
          <Icon name="gear" />
        </button>
      </div>
    </aside>
  )
}

/** 窗口按钮需要的状态与事件。 */
export type WindowControlsProps = {
  sidebarOpen: boolean
  canGoBack: boolean
  canGoForward: boolean
  onToggleSidebar: () => void
  onBack: () => void
  onForward: () => void
}

/** 固定在窗口左上角的侧栏开关和前进后退；侧栏收起后仍留在原位。 */
export function WindowControls({
  sidebarOpen,
  canGoBack,
  canGoForward,
  onToggleSidebar,
  onBack,
  onForward,
}: WindowControlsProps) {
  return (
    <div className="window-controls">
      <TrafficLights />
      <button
        className="icon-btn"
        type="button"
        aria-label={sidebarOpen ? "收起侧栏" : "展开侧栏"}
        aria-expanded={sidebarOpen}
        title={sidebarOpen ? "收起侧栏 ⌘\\" : "展开侧栏 ⌘\\"}
        onClick={onToggleSidebar}
      >
        <Icon name="sidebar" />
      </button>
      <button
        className="icon-btn"
        type="button"
        aria-label="后退"
        title="后退 ⌘["
        disabled={!canGoBack}
        onClick={onBack}
      >
        <Icon name="left" />
      </button>
      <button
        className="icon-btn"
        type="button"
        aria-label="前进"
        title="前进 ⌘]"
        disabled={!canGoForward}
        onClick={onForward}
      >
        <Icon name="right" />
      </button>
    </div>
  )
}

/** 普通页面的内容区：顶栏拖动区加可滚动区域。 */
export function ScrollPanel({ children }: { children: ReactNode }) {
  return (
    <section className="view">
      <PanelTop />
      <div className="panel-scroll">{children}</div>
    </section>
  )
}

/** 内容区顶栏，只放拖动区和可选操作。 */
export function PanelTop({ children }: { children?: ReactNode }) {
  return (
    <div className="panel-top">
      <span className="spacer" />
      {children}
    </div>
  )
}
