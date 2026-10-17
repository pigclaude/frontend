// 负责窗口外壳、工作区侧栏、设置侧栏和当前用户菜单。
import type { ReactNode } from "react"
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
import type { Screen } from "../screens/screen"

const settingsScreens = new Set<Screen>([
  "profile",
  "accounts",
  "proxies",
  "switching",
  "usage",
  "environment",
  "general",
  "appearance",
  "session",
  "network",
  "data",
  "about",
])

/** 窗口外壳需要的状态与事件。 */
export type SidebarProps = {
  screen: Screen
  navigation: ProjectNavigationState
  onNavigate: (screen: Screen) => void
  onToggleProject: (projectId: string, expanded: boolean) => void
  onNewSession: (projectId?: string) => void
  onLogout: () => void
  theme: "light" | "dark"
  onToggleTheme: () => void
}

/** 按当前页面切换工作区侧栏和设置侧栏。 */
export function Sidebar({
  screen,
  navigation,
  onNavigate,
  onToggleProject,
  onNewSession,
  onLogout,
  theme,
  onToggleTheme,
}: SidebarProps) {
  const inSettings = settingsScreens.has(screen)
  return (
    <aside className="sidebar" aria-label={inSettings ? "设置导航" : "侧栏"}>
      <div className="side-top">
        <TrafficLights />
        <button className="icon-btn" type="button" aria-label="收起侧栏">
          <Icon name="sidebar" />
        </button>
        <button className="icon-btn" type="button" aria-label="后退">
          <Icon name="left" />
        </button>
        <button className="icon-btn" type="button" aria-label="前进">
          <Icon name="right" />
        </button>
        <span className="spacer" />
      </div>
      <div className="side-scroll">
        {inSettings ? (
          <SettingsSidebar screen={screen} onNavigate={onNavigate} />
        ) : (
          <WorkspaceSidebar
            screen={screen}
            navigation={navigation}
            onNavigate={onNavigate}
            onToggleProject={onToggleProject}
            onNewSession={onNewSession}
          />
        )}
      </div>
      <div className="side-foot">
        <DropdownMenu>
          <DropdownMenuTrigger className="acct-switch">
            <span className="avatar">林</span>
            <span className="who truncate">林舟</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start">
            <DropdownMenuItem onSelect={() => onNavigate("profile")}>
              <Icon name="user" />
              我的账户
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onNavigate("general")}>
              <Icon name="gear" />
              设置
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onToggleTheme}>
              <Icon name="moon" />
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
          onClick={() => onNavigate("general")}
        >
          <Icon name="gear" />
        </button>
      </div>
    </aside>
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
