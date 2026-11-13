// 负责主窗口外壳：用 Pigcode 的窗口按钮、标题栏、工作区侧栏、分隔条与命令面板组合出 PigClaude 的外壳。
// 布局与类名和 Pigcode 的 Shell 相同；PigClaude 没有的插件、定时任务入口和右栏不出现，
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
import { useLocale, useSidebarGrouping } from "@pigclaude/ui-primitives"
import {
  CommandPalette,
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
import { SidebarResizer, useSidebarWidth } from "@pigclaude/ui-shell/panel-resizer"
import { titleBarMenus } from "@pigclaude/ui-shell/title-bar-menus"
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
  onOpenSettings: () => void
  /** Windows/Linux 标题栏「帮助 → 关于」。 */
  onAbout: () => void
  settingsSidebar: ReactNode
  /** 工作区侧栏底部上方的提醒。 */
  notice?: ReactNode
  /** 工作区侧栏底部一行。 */
  footer: ReactNode
  children: ReactNode
}

/** 组合窗口外壳；窄窗口里侧栏变成抽屉，点遮罩或按 Esc 关闭。 */
export function PigclaudeShell(props: PigclaudeShellProps) {
  const { t } = useLocale()
  const registry = useExtensionRegistry()
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth()
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

  // 命令通过 ref 调用最新的回调；只有语言变化（关键词跟着变）时才重新登记。
  const commandActions = useRef({ props, toggleSidebar })
  useLayoutEffect(() => {
    commandActions.current = { props, toggleSidebar }
  })
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
      },
      t,
    )
  }, [registry, t])

  const appClass = ["app", open ? "" : "is-collapsed", narrow && drawerOpen ? "is-drawer-open" : ""]
    .filter(Boolean)
    .join(" ")
  const appStyle = { "--sidebar-w": `${sidebarWidth}px` } as CSSProperties
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
        {props.inSettings ? null : props.notice}
        {props.inSettings ? null : props.footer}
      </aside>
      {open && !narrow ? <SidebarResizer width={sidebarWidth} onChange={setSidebarWidth} /> : null}
      <div className="drawer-scrim" aria-hidden="true" onClick={() => setDrawerOpen(false)} />
      <div className="workspace">
        <main className="panel">{props.children}</main>
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
