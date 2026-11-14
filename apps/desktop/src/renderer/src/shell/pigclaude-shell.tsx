// 负责主窗口外壳：用 Pigcode 的窗口按钮、更新入口、标题栏、工作区侧栏、分隔条与命令面板组合出
// PigClaude 的外壳。
// 布局与类名和 Pigcode 的 Shell 相同；设置侧栏、工作台与底部账户行由调用方提供，
// 设置侧栏、侧栏提醒与底部账户行由调用方给出。
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"
import type { Project, Thread } from "@pigclaude/ui-contracts"
import { useExtensionRegistry } from "@pigclaude/client-runtime"
import { ListRow, useLocale, useSidebarGrouping } from "@pigclaude/ui-primitives"
import { useText } from "../locale/text"
import {
  CommandPalette,
  Icon,
  TitleBar,
  WindowControls,
  WorkspaceSidebar,
  hasCustomTitleBar,
  nativePlatform,
  useModifierHints,
  useNarrowWindow,
  visibleThreads,
  type ThreadStatus,
} from "@pigclaude/ui-shell"
import {
  PanelResizer,
  SidebarResizer,
  useRightWidth,
  useSidebarWidth,
} from "@pigclaude/ui-shell/panel-resizer"
import { titleBarMenus } from "@pigclaude/ui-shell/title-bar-menus"
import { AppUpdateCenter } from "./app-update-center"
import { registerShellCommands } from "./shell-commands"
import { useShellKeys } from "./use-shell-keys"

/** 外壳需要的数据与事件；项目和会话由工作区与当前会话映射而来。 */
export type PigclaudeShellProps = {
  /** 兼容开发预览和旧的可达性检查；值来自当前 NavLocation。 */
  dataScreen?: string
  /** 显示设置侧栏而不是工作区侧栏。 */
  inSettings: boolean
  /** 当前位置的标识；变化时收起窄窗口里的抽屉。 */
  locationKey: string
  projects: Project[]
  threads: Thread[]
  activeThreadId: string | null
  threadStatus: Record<string, ThreadStatus>
  agentNames: Readonly<Record<string, string>>
  expandedProjects: Record<string, boolean>
  canGoBack: boolean
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
  onToggleProject: (projectId: string, expanded: boolean) => void
  onNewSession: (projectId?: string) => void
  onOpenThread: (threadId: string) => void
  /** 打开「添加项目」对话框。 */
  onAddProject: () => void
  /** 会话历史操作沿用工作区侧栏的右键菜单。 */
  onRenameThread?: (id: string, title: string) => void
  onArchiveThread?: (id: string) => void
  onOpenArchived?: () => void
  /** 项目右键菜单：只改侧栏显示名；从侧栏移除，不删文件。 */
  onRenameProject: (projectId: string, name: string) => void
  onRemoveProject: (projectId: string) => void
  /** 开合右侧工作台，与 ⌘J 相同；没有工作台时不传，命令面板和 `/panel` 都不出现。 */
  onToggleWorkbench?: () => void
  /** 现在能不能开合右侧工作台；和 ⌘J 一样只在会话页和新会话页为 true。 */
  canToggleWorkbench?: boolean
  /** 项目行的「查看文件」：在工作台里打开这个项目的文件面板。 */
  onBrowseFiles?: (projectId: string) => void
  onOpenSettings: () => void
  /** Windows/Linux 标题栏「帮助 → 关于」。 */
  onAbout: () => void
  settingsSidebar: ReactNode
  /** 工作区侧栏底部上方的提醒。 */
  notice?: ReactNode
  /** 工作区侧栏底部一行。 */
  footer: ReactNode
  /** 工作区的原生工作台；关闭时只隐藏内容，保留终端和浏览器标签。 */
  workbench?: { content: ReactNode; open: boolean; maximized: boolean }
  children: ReactNode
}

/** 组合窗口外壳；窄窗口里侧栏变成抽屉，点遮罩或按 Esc 关闭。 */
export function PigclaudeShell(props: PigclaudeShellProps) {
  const { t } = useLocale()
  const { t: text } = useText()
  const registry = useExtensionRegistry()
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth()
  const [rightWidth, setRightWidth] = useRightWidth()
  const [open, setOpen] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [grouping] = useSidebarGrouping()
  const narrow = useNarrowWindow()
  const platform = nativePlatform()
  const shortcutHints = useModifierHints() && !props.inSettings

  // 抽屉只在窄窗口里有意义；变宽后复位，切到别的位置后收起，回到内容。
  useEffect(() => {
    if (!narrow) setDrawerOpen(false)
  }, [narrow])
  useEffect(() => {
    setDrawerOpen(false)
  }, [props.locationKey])

  // 标题栏、交通灯留白按平台区分，CSS 依赖 html[data-platform]；绘制前写入，避免布局跳动。
  useLayoutEffect(() => {
    if (platform) document.documentElement.dataset.platform = platform
  }, [platform])

  // macOS 全屏时交通灯隐藏，CSS 依赖 html[data-fullscreen] 收回留白。
  useEffect(() => {
    const bridge = window.pigcodeNative
    if (!bridge?.onFullScreenChange) return undefined
    const root = document.documentElement
    const apply = (fullScreen: boolean): void => {
      if (fullScreen) root.dataset.fullscreen = "true"
      else delete root.dataset.fullscreen
    }
    void bridge
      .isFullScreen?.()
      .then(apply)
      .catch(() => undefined)
    return bridge.onFullScreenChange(apply)
  }, [])

  function toggleSidebar(): void {
    if (narrow) setDrawerOpen((current) => !current)
    else setOpen((current) => !current)
  }

  useShellKeys(
    {
      onBack: props.onBack,
      onForward: props.onForward,
      onTogglePalette: () => setPaletteOpen((value) => !value),
      onNewSession: () => props.onNewSession(),
      onToggleSidebar: toggleSidebar,
      onOpenSettings: props.onOpenSettings,
      onOpenNth: (index) => {
        const target = visibleThreads(props.projects, props.threads, grouping, {
          ...props.expandedProjects,
        })[index - 1]
        if (!target) return false
        setDrawerOpen(false)
        props.onOpenThread(target.id)
        return true
      },
      onCloseDrawer: () => setDrawerOpen(false),
    },
    !props.inSettings,
  )

  // 命令通过 ref 调用最新的回调，不随每次渲染重新登记。
  const commandActions = useRef({ props, toggleSidebar })
  useLayoutEffect(() => {
    commandActions.current = { props, toggleSidebar }
  })
  const hasWorkbench = props.onToggleWorkbench !== undefined
  useEffect(() => {
    if (!registry) return undefined
    const latest = () => commandActions.current
    return registerShellCommands(
      registry,
      {
        onNewSession: () => latest().props.onNewSession(),
        onToggleSidebar: () => latest().toggleSidebar(),
        onSettings: () => latest().props.onOpenSettings(),
        onAddProject: () => latest().props.onAddProject(),
        ...(hasWorkbench ? { onToggleWorkbench: () => latest().props.onToggleWorkbench?.() } : {}),
      },
      t,
    )
  }, [registry, t, hasWorkbench])

  const rightOpen = props.workbench?.open === true && !props.inSettings
  const rightMax = rightOpen && props.workbench?.maximized === true
  const appClass = [
    "app",
    open ? "" : "is-collapsed",
    narrow && drawerOpen ? "is-drawer-open" : "",
    rightOpen ? "has-right" : "",
    rightMax ? "is-right-max" : "",
  ]
    .filter(Boolean)
    .join(" ")
  const appStyle = {
    "--sidebar-w": `${sidebarWidth}px`,
    "--right-w": `${rightWidth}px`,
  } as CSSProperties
  const menus = hasCustomTitleBar(platform)
    ? titleBarMenus({
        t,
        newThread: () => props.onNewSession(),
        addProject: props.onAddProject,
        settings: props.onOpenSettings,
        about: props.onAbout,
        palette: () => setPaletteOpen(true),
        toggleSidebar,
      })
    : null

  return (
    <div className={appClass} style={appStyle} data-main-window="" data-screen={props.dataScreen}>
      {menus ? <TitleBar menus={menus} label={t("menu.label")} /> : null}
      <WindowControls
        sidebarOpen={narrow ? drawerOpen : open}
        canGoBack={props.canGoBack}
        canGoForward={props.canGoForward}
        onToggleSidebar={toggleSidebar}
        onSearch={() => setPaletteOpen(true)}
        onBack={props.onBack}
        onForward={props.onForward}
        updates={<AppUpdateCenter />}
      />
      <aside
        className={shortcutHints ? "sidebar show-shortcuts" : "sidebar"}
        aria-label={props.inSettings ? t("settings.title") : t("nav.projects")}
      >
        <div className="side-top" />
        {props.inSettings ? (
          props.settingsSidebar
        ) : (
          <WorkspaceSidebar
            projects={props.projects}
            threads={props.threads}
            activeThreadId={props.activeThreadId}
            threadStatus={props.threadStatus}
            agentNames={props.agentNames}
            expandedProjects={props.expandedProjects}
            onAddProject={props.onAddProject}
            onRenameThread={props.onRenameThread}
            onArchiveThread={props.onArchiveThread}
            onRenameProject={props.onRenameProject}
            onRemoveProject={props.onRemoveProject}
            onBrowseFiles={
              props.onBrowseFiles
                ? (projectId) => {
                    setDrawerOpen(false)
                    props.onBrowseFiles?.(projectId)
                  }
                : undefined
            }
            onToggleProject={props.onToggleProject}
            onOpenThread={(threadId) => {
              setDrawerOpen(false)
              props.onOpenThread(threadId)
            }}
            onNewThread={(projectId) => {
              setDrawerOpen(false)
              props.onNewSession(projectId)
            }}
            shortcutHints={shortcutHints}
          />
        )}
        {props.inSettings || !props.onOpenArchived ? null : (
          <ListRow
            render={<button type="button" />}
            className="nav-item"
            leading={<Icon name="archive" aria-hidden="true" />}
            title={text("shell.session.archived")}
            onClick={() => {
              setDrawerOpen(false)
              props.onOpenArchived?.()
            }}
          />
        )}
        {props.inSettings ? null : props.notice}
        {props.inSettings ? null : props.footer}
      </aside>
      {open && !narrow ? <SidebarResizer width={sidebarWidth} onChange={setSidebarWidth} /> : null}
      <div className="drawer-scrim" aria-hidden="true" onClick={() => setDrawerOpen(false)} />
      <div className="workspace">
        <main className="panel">{props.children}</main>
        {props.workbench ? (
          <div className="right-panel-slot" hidden={!rightOpen}>
            {rightOpen && !rightMax ? (
              <PanelResizer width={rightWidth} onChange={setRightWidth} />
            ) : null}
            {props.workbench.content}
          </div>
        ) : null}
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        projects={props.projects}
        threads={props.threads}
        activeThreadId={props.activeThreadId}
        onNewThread={(projectId) => props.onNewSession(projectId)}
        onOpenThread={props.onOpenThread}
      />
    </div>
  )
}
