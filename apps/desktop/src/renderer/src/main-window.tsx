// 负责登录后的主窗口：把工作区、当前会话和账号状态接到 Pigcode 外壳，并按当前位置画内容区页面。
// 聊天、账号、代理、环境、用量和托盘都接真实会话与本地数据；只有浏览器预览会传入演示工作台。
import { useCallback, useEffect, useRef, useState } from "react"
import type { MembershipView } from "@pigclaude/contracts/membership"
import { OpenInButton, useToast } from "@pigclaude/ui-shell"
import { PanelLayoutControls } from "@pigclaude/ui-workbench"
import { Workbench, type FilesRequest, type WorkbenchActions } from "./workbench/workbench"
import { TerminalDrawer } from "./workbench/terminal-drawer"
import type { PreviewWorkbench } from "./fixtures/preview-workbench"
import { workspaceRevision } from "./models/workspace-revision"
import { ChatScreen } from "./screens/chat-screen"
import { MainWindowSettings } from "./screens/main-window-settings"
import type { BrowserProfilesController } from "./hooks/use-browser-profiles"
import type { AppInfo } from "../../preload/index"
import { TrayScreen } from "./screens/tray-screen"
import type { ClaudeAccountsController } from "./hooks/use-claude-accounts"
import { sessionAccountId, useSession } from "./hooks/use-session"
import { useSessionHistory } from "./hooks/use-session-history"
import { SessionDeleteDialog } from "./components/session-delete-dialog"
import { useProjectConfigurationDialog } from "./components/project-configuration-dialog"
import type { ProjectDrafts } from "./hooks/use-project-draft"
import { useComposerReferenceQueue } from "./hooks/use-composer-reference"
import { useSessionNotices } from "./hooks/use-session-notices"
import { useWorkspaces } from "./hooks/use-workspaces"
import { useWorkspaceSelection } from "./hooks/use-workspace-selection"
import { useWorkspaceShortcuts } from "./hooks/use-workspace-shortcuts"
import { fill, useText } from "./locale/text"
import { composerSessionOptions } from "./models/composer-session-options"
import { projectNameFromPath, workspaceErrorMessage } from "./models/project-model"
import { toPoolAccount } from "./models/claude-account-view"
import type { NavLocation } from "./models/navigation"
import { useSessionReferenceRecovery } from "./screens/session-reference-recovery"
import type { AppearanceController } from "./hooks/use-appearance"
import type { ResolvedTheme } from "./models/theme-model"
import { AddProjectDialog } from "./shell/add-project-dialog"
import { PigclaudeShell } from "./shell/pigclaude-shell"
import { projectActions } from "./shell/project-actions"
import { SettingsSidebar } from "./shell/settings-sidebar"
import { SidebarFooter } from "./shell/sidebar-footer"
import { SidebarNotice, sessionNotice } from "./shell/sidebar-notice"
import {
  SettingsContributionView,
  SettingsRegistry,
  settingsLocation,
} from "./shell/settings-registry"
import {
  newSessionWorkspace,
  sessionAgentNames,
  sidebarProjectPaths,
  toggleExpanded,
  workspaceProjects,
  workspaceThreads,
} from "./shell/workspace-threads"

/** 主窗口需要的位置状态与事件；账号控制器由 App 持有，避免同一页面出现两份陈旧列表。 */
export type MainWindowProps = {
  location: NavLocation
  /** 历史中最近访问的工作区，整窗授权回来时设置页仍能回到它。 */
  lastWorkspace: NavLocation
  /** 旧测试和开发预览使用的页面名；导航本身以 location 为唯一状态。 */
  screen?: string
  canGoBack: boolean
  canGoForward: boolean
  membership: MembershipView
  drafts: ProjectDrafts
  claudeAccounts: ClaudeAccountsController
  browserProfiles?: BrowserProfilesController
  onNavigate: (location: NavLocation) => void
  /** 用各个已删除会话的原项目草稿替换导航记录。 */
  onSessionsDeleted: (projects: ReadonlyMap<string, string>, selection: string | null) => void
  onBack: () => void
  onForward: () => void
  onOpenAuthorize: () => void
  onReauthorizeAccount?: (accountId: string) => void
  onLogout: () => void
  theme: ResolvedTheme
  appearance: AppearanceController
  /** 浏览器预览里代替桌面桥的演示工作台和它的项目。 */
  previewWorkbench?: PreviewWorkbench | undefined
}

/** 画外壳与内容区；离开设置时回到离开前的工作区位置。 */
export function MainWindow({
  location,
  lastWorkspace,
  screen,
  canGoBack,
  canGoForward,
  membership,
  drafts,
  claudeAccounts,
  browserProfiles,
  onNavigate,
  onSessionsDeleted,
  onBack,
  onForward,
  onOpenAuthorize,
  onReauthorizeAccount,
  onLogout,
  theme,
  appearance,
  previewWorkbench,
}: MainWindowProps) {
  const { t } = useText()
  const projectConfiguration = useProjectConfigurationDialog()
  const toast = useToast()
  const pool = claudeAccounts
  const session = useSession(undefined, location.kind === "session" ? location.sessionId : null)
  useSessionNotices(session.notice)
  const workspaces = useWorkspaces()
  const page = location.kind === "settings" ? location.page : null
  const sessionId =
    location.kind === "session" ? (location.sessionId ?? session.state.sessionId) : null
  const selection = useWorkspaceSelection(workspaces.add)
  const { selected: selectedWorkspace, projectOf } = selection
  const currentLocation = useRef(location)
  currentLocation.current = location
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [addingProject, setAddingProject] = useState(false)
  const workbench = useRef<WorkbenchActions>(null)
  const [rightOpen, setRightOpen] = useState(false)
  const [rightMax, setRightMax] = useState(false)
  const [filesRequest, setFilesRequest] = useState<FilesRequest | null>(null)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalMounted, setTerminalMounted] = useState(false)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const accounts = pool.accounts.map((account) => toPoolAccount(account, pool.proxies))
  const history = useSessionHistory({
    page,
    selection: sessionId,
    summaries: session.summaries,
    hostRemoved: session.removedSessions,
    refreshActive: session.refreshSummaries,
    report: (message) => toast(message, "alert"),
    onSessionsDeleted: (projects) => onSessionsDeleted(projects, sessionId),
  })
  const selectedProject = projectOf(selectedWorkspace)
  const routedProject = location.kind === "draft" ? location.projectId : undefined
  const workspace =
    routedProject !== undefined &&
    routedProject !== selectedProject &&
    (workspaces.paths.includes(routedProject) ||
      [...history.deleted.values()].includes(routedProject) ||
      session.summaries.some(
        (summary) => summary.projectPath === routedProject && summary.restorable,
      ))
      ? selection.workspaceOf(routedProject)
      : (selectedWorkspace ?? workspaces.paths[0] ?? previewWorkbench?.root ?? null)
  const activeSummary = history.summaryForSession(sessionId)
  const sessionWorkspace =
    activeSummary?.workspace ??
    (sessionId === null ? null : history.workspaces.get(sessionId)) ??
    null
  const sidebar = workspaceThreads({
    summaries: session.summaries,
    states: session.states,
    workspaces: history.workspaces,
    hidden: history.hidden,
    projectOf,
    untitled: t("shell.session.untitled"),
    accounts: pool.accounts,
  })
  const sidebarPaths = sidebarProjectPaths(
    workspaces.paths,
    sidebar.threads,
    sidebar.statuses,
    session.summaries,
  )
  const inChat = location.kind === "draft" || location.kind === "session"
  const bridge = window.pigclaude?.workbench ?? previewWorkbench?.bridge
  const sessionActive = session.state.started && !session.state.ended
  const chatWorkspace = sessionWorkspace ?? workspace
  const chatProject = activeSummary?.projectPath ?? projectOf(chatWorkspace)
  const threadOptions = composerSessionOptions({
    summaries: session.summaries,
    archived: history.archived,
    deleted: history.deleted,
    current: sessionId,
    project: chatProject,
    names: workspaces.names,
    untitled: t("shell.session.untitled"),
  })
  const draftProject = projectOf(workspace)
  const projectDraft = drafts.forProject(draftProject)
  const composerReferences = useComposerReferenceQueue(sessionId, projectDraft.key, (path) =>
    location.kind === "draft" && draftProject ? projectDraft.key : openDraft(draftProject ?? path),
  )
  const recoverReference = useSessionReferenceRecovery(sessionId, {
    projects: sidebarPaths,
    pickWorkspace: workspaces.pick,
    openDraft,
    queue: composerReferences.queue,
    untitled: t("shell.session.untitled"),
    report: (error) => toast(workspaceErrorMessage(error, t("shell.project.unavailable")), "alert"),
  })
  const currentDraft = useRef(draftProject)
  currentDraft.current = draftProject
  const workbenchRoot = chatWorkspace
  const turnActive = sessionActive && session.state.activeTurnId !== null
  const toggleRight = useCallback(() => {
    setRightOpen((open) => !open)
    setRightMax(false)
  }, [])
  const toggleTerminal = useCallback(() => {
    if (!workbenchRoot) return
    setTerminalMounted(true)
    setTerminalOpen((open) => !open)
  }, [workbenchRoot])

  useWorkspaceShortcuts(!!bridge && inChat, workbenchRoot, toggleTerminal, toggleRight)

  useEffect(() => {
    const read = window.pigclaude?.appInfo
    if (!read) return
    void read()
      .then(setAppInfo)
      .catch(() => undefined)
  }, [])

  function settings(next: string): void {
    onNavigate(settingsLocation(next))
  }

  function newSession(projectId?: string): void {
    const path = newSessionWorkspace(
      projectId,
      sidebarPaths,
      projectOf(sessionWorkspace) ?? workspace,
    )
    openDraft(path)
  }

  function openDraft(path: string | null, atProjectRoot = false): string | null {
    const projectId = projectOf(path)
    const directory =
      projectId === null || atProjectRoot ? projectId : selection.workspaceOf(projectId)
    if (!canSelectWorkspace(directory)) return null
    if (atProjectRoot && directory !== null) selection.selectWorktree(directory, directory)
    else selection.select(directory)
    onNavigate({ kind: "draft", ...(projectId === null ? {} : { projectId }) })
    return drafts.forProject(projectId).key
  }

  /** 侧栏「查看文件」打开目标项目草稿的工作台。 */
  function browseFiles(projectId: string): void {
    if (!openDraft(projectId)) return
    setFilesRequest({ root: selection.workspaceOf(projectId), id: Date.now() })
    setRightOpen(true)
    setRightMax(false)
  }

  function addWorkspace(path: string): void {
    if (!canSelectWorkspace(path)) return
    void workspaces
      .add(path)
      .then(() => {
        openDraft(path)
        toast(fill(t("shell.project.added"), { name: projectNameFromPath(path) }), "folder")
      })
      .catch((error: unknown) =>
        toast(workspaceErrorMessage(error, t("shell.project.unavailable")), "info"),
      )
  }

  function canSelectWorkspace(path: string | null): boolean {
    return path === workbenchRoot || (workbench.current?.confirmSwitch() ?? true)
  }

  const renderSettingsPage = (page: string) => (
    <MainWindowSettings
      page={page}
      membership={membership}
      pool={pool}
      browserProfiles={browserProfiles}
      session={session}
      history={history}
      canSelectWorkspace={canSelectWorkspace}
      workspace={workspace}
      appInfo={appInfo}
      appearance={appearance}
      onOpenAuthorize={onOpenAuthorize}
      onReauthorizeAccount={onReauthorizeAccount}
      onOpenSettings={settings}
      onNavigate={onNavigate}
      onLogout={onLogout}
    />
  )

  return (
    <PigclaudeShell
      {...(screen === undefined ? {} : { dataScreen: screen })}
      inSettings={page !== null}
      {...(bridge
        ? {
            workbench: {
              open: inChat && rightOpen,
              maximized: rightMax,
              content: (
                <Workbench
                  ref={workbench}
                  key={workbenchRoot}
                  bridge={bridge}
                  root={workbenchRoot}
                  sessionId={sessionId}
                  sessionActive={sessionActive}
                  turnActive={turnActive}
                  workspaceRevision={workspaceRevision(session.state)}
                  visible={inChat && rightOpen}
                  open={rightOpen}
                  maximized={rightMax}
                  onToggle={toggleRight}
                  onShow={() => setRightOpen(true)}
                  onMaximize={() => setRightMax((value) => !value)}
                  filesRequest={filesRequest}
                  onSelectWorkspace={async (path) => selection.selectWorktree(path, workbenchRoot)}
                />
              ),
            },
          }
        : {})}
      locationKey={page ?? sessionId ?? routedProject ?? location.kind}
      projects={workspaceProjects(sidebarPaths, workspaces.names)}
      onProjectConfiguration={projectConfiguration.open}
      threads={sidebar.threads}
      activeThreadId={sessionId}
      threadStatus={sidebar.statuses}
      agentNames={sessionAgentNames(pool.accounts)}
      expandedProjects={expanded}
      canGoBack={canGoBack}
      canGoForward={canGoForward}
      onBack={onBack}
      onForward={onForward}
      onToggleProject={(projectId, open) =>
        setExpanded((current) => toggleExpanded(current, projectId, open))
      }
      onNewSession={newSession}
      {...(bridge
        ? { onBrowseFiles: browseFiles, onToggleWorkbench: toggleRight, canToggleWorkbench: inChat }
        : {})}
      onOpenThread={(id) => {
        const path =
          session.summaries.find((item) => item.sessionId === id)?.workspace ??
          history.workspaces.get(id)
        if (path && !canSelectWorkspace(path)) return
        onNavigate({ kind: "session", sessionId: id })
      }}
      onReferenceThread={composerReferences.reference}
      onAddProject={() => setAddingProject(true)}
      {...(history.enabled
        ? {
            onRenameThread: history.rename,
            onArchiveThread: (id: string) => void history.archive(id, true),
            onOpenArchived: () => settings("archived"),
          }
        : {})}
      {...projectActions({
        workspaces,
        t,
        toast,
        onRemoved: (path) => {
          if (selectedWorkspace === path) selection.select(null)
        },
      })}
      onOpenSettings={() => settings("general")}
      onAbout={() => settings("about")}
      settingsSidebar={
        <SettingsSidebar
          activePage={page ?? "general"}
          onSelect={(next) => settings(next)}
          onExit={() => onNavigate(lastWorkspace)}
        />
      }
      notice={
        <SidebarNotice
          accounts={accounts.filter((account) => account.needsReauth)}
          session={sessionNotice({
            live: sessionActive,
            accountId: sessionAccountId(session),
            accounts: pool.accounts,
            proxies: pool.proxies,
          })}
          onOpen={() => settings("accounts")}
        />
      }
      footer={
        <SidebarFooter
          account={membership.account}
          theme={theme}
          onOpenProfile={() => settings("profile")}
          onOpenClaudeAccounts={() => settings("accounts")}
          onOpenSettings={() => settings("general")}
          onToggleTheme={() =>
            appearance.update((current) => ({
              ...current,
              mode: theme === "light" ? "dark" : "light",
            }))
          }
          onLogout={onLogout}
        />
      }
    >
      <SettingsRegistry
        render={renderSettingsPage}
        onSelect={settings}
        archiveAvailable={history.enabled}
      />
      <AddProjectDialog open={addingProject} onOpenChange={setAddingProject} onAdd={addWorkspace} />
      <SessionDeleteDialog history={history} />
      {projectConfiguration.dialog}
      {inChat ? (
        <ChatScreen
          {...(bridge
            ? {
                layoutControls: (
                  <PanelLayoutControls
                    rightOpen={rightOpen}
                    onToggleRight={toggleRight}
                    terminalOpen={terminalOpen}
                    {...(workbenchRoot ? { onToggleTerminal: toggleTerminal } : {})}
                  />
                ),
                onOpenFile: (path: string) => {
                  workbench.current?.openFile(path)
                  setRightOpen(true)
                },
                onViewDiff: (path?: string) => {
                  workbench.current?.openDiff(path)
                  setRightOpen(true)
                },
                workbench: bridge,
              }
            : {})}
          {...(chatWorkspace ? { openIn: <OpenInButton path={chatWorkspace} /> } : {})}
          fresh={location.kind === "draft"}
          referenceRequest={composerReferences.request}
          threadOptions={threadOptions}
          key={sessionId ?? draftProject}
          session={session}
          workspace={chatWorkspace}
          workspaceProject={chatProject}
          onProjectConfiguration={projectConfiguration.open}
          workspaceOptions={sidebarPaths}
          accounts={pool.accounts}
          proxies={pool.proxies}
          onPickWorkspace={() => {
            void workspaces
              .pick()
              .then((path) => {
                if (path !== null) openDraft(path)
              })
              .catch((error: unknown) =>
                toast(workspaceErrorMessage(error, t("shell.project.unavailable")), "info"),
              )
          }}
          onSelectWorkspace={openDraft}
          onWorkspaceUsed={(path, project, id) => {
            if (id) history.rememberWorkspace(id, path)
            selection.used(path, project, false)
          }}
          onDraftOpened={(id, project) => {
            const location = currentLocation.current
            if (location.kind !== "draft" && location.kind !== "session") return
            if (location.kind === "session" && location.sessionId !== undefined) return
            if (currentDraft.current === project) onNavigate({ kind: "session", sessionId: id })
          }}
          {...(activeSummary === undefined ? {} : { summary: activeSummary })}
          onRecoverReference={recoverReference}
          projectDraft={projectDraft}
          identifySessions
          onOpen={onNavigate}
          smartPunctuation={appearance.settings.smartPunctuation}
        />
      ) : null}
      {bridge && workbenchRoot && terminalMounted ? (
        <TerminalDrawer
          key={workbenchRoot}
          bridge={bridge}
          root={workbenchRoot}
          open={inChat && terminalOpen}
          onClose={() => setTerminalOpen(false)}
        />
      ) : null}
      {location.kind === "tray" ? (
        <TrayScreen
          membership={membership}
          accounts={pool.accounts}
          onOpenAccounts={() => settings("accounts")}
          onOpenSettings={() => settings("general")}
        />
      ) : null}
      {page !== null ? <SettingsContributionView page={page} /> : null}
    </PigclaudeShell>
  )
}
