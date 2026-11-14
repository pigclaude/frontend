// 负责聊天页：草稿选工作区、分支和 worktree，开始会话、时间线、工具/终端/浏览器视图、权限回答、
// 换号提示和错误。
// 页面只消费 useSession 控制器，界面完全由 Pigcode 的 ui-chat 绘制。

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  isAccountSelectable,
  type ClaudeAccountView,
  type ProxyView,
} from "@pigclaude/contracts/claude-account"
import type { AgentFeatures, RuntimeMode } from "@pigclaude/ui-contracts"
import { ChatView, NewThreadView } from "@pigclaude/ui-chat"
import {
  prefillComposer,
  type ComposerModelChoice,
  type ComposerSubmitOptions,
  type PermissionMode,
} from "@pigclaude/ui-composer"
import { useToast } from "@pigclaude/ui-shell"
import { PermissionDock } from "../components/permission-dock"
import { PermissionPrompt, type PermissionChoice } from "../components/permission-prompt"
import { ToolRenderers } from "../components/tool-renderers"
import { sessionAccountId, type SessionController } from "../hooks/use-session"
import {
  DEFAULT_PERMISSION_LEVEL,
  accountIdForAgent,
  agentIdForAccount,
  composerAgent,
  composerAgents,
  composerCatalog,
  composerLevel,
  currentAccountAgent,
  effortForComposer,
  permissionView,
  sessionPermissionMode,
  type ComposerConfig,
  type PermissionView,
} from "../models/composer-config"
import { projectNameFromPath } from "../models/project-model"
import type { NavLocation } from "../models/navigation"
import { pendingPermission } from "../models/session-permissions"
import { threadView } from "../models/thread-view"
import type { SessionEffort } from "../../../main/session/session-types"
import type { WorkbenchBridge } from "../../../workbench-contract"
import { useSlashCommands } from "../shell/registry-slash-commands"
import { useSessionDefaults } from "../hooks/use-session-defaults"
import { useDraftWorkspace } from "./draft-workspace"

/** Claude 会话支持的 Agent 功能；界面据此显示计划、中断和审批等控件。 */
const CLAUDE_FEATURES: AgentFeatures = {
  streaming: true,
  approvals: true,
  questions: false,
  plan: true,
  resume: true,
  fork: false,
  rollback: false,
  checkpoint: false,
  subagents: true,
  mcp: true,
  images: false,
  usage: true,
  modelCatalog: true,
  nativeSessionId: true,
}

/** 聊天视图用的功能集：审批卡片由页面挂在输入框上方（参照 ZCode），时间线不再画一遍。 */
const CHAT_FEATURES: AgentFeatures = { ...CLAUDE_FEATURES, approvals: false }

/** 会话页面 props。 */
export type ChatScreenProps = {
  fresh: boolean
  session: SessionController
  workspace: string | null
  /** workspace 所属的项目；workspace 是 worktree 时是它的项目，否则就是 workspace 本身。 */
  workspaceProject?: string | null
  workspaceOptions: string[]
  accounts: ClaudeAccountView[]
  proxies: ProxyView[]
  onPickWorkspace: () => void
  onSelectWorkspace: (path: string) => void
  /** 会话在 path 里开始了；project 是 path 所属的项目。 */
  onWorkspaceUsed: (path: string, project: string) => void
  onOpen: (location: NavLocation) => void
  smartPunctuation: boolean
  layoutControls?: ReactNode
  /** 线程头的「在应用中打开」按钮；有项目时由调用方给出。 */
  openIn?: ReactNode
  onOpenFile?: (path: string) => void
  onViewDiff?: (path?: string) => void
  /** 草稿读写分支、新建 worktree 用的工作台桥；没有时草稿不显示分支控件。 */
  workbench?: WorkbenchBridge
}

/** 绘制新会话草稿或进行中的会话。 */
export function ChatScreen({
  fresh,
  session,
  workspace,
  workspaceProject = workspace,
  workspaceOptions,
  accounts,
  proxies,
  onPickWorkspace,
  onSelectWorkspace,
  onWorkspaceUsed,
  onOpen,
  smartPunctuation,
  layoutControls,
  openIn,
  onOpenFile,
  onViewDiff,
  workbench,
}: ChatScreenProps) {
  const toast = useToast()
  const commands = useSlashCommands()
  const { state } = session
  const live = state.started && !state.ended
  const { defaults } = useSessionDefaults()
  const defaultLevel = permissionView(defaults.permissionMode, DEFAULT_PERMISSION_LEVEL).level
  const [modelId, setModelId] = useState(defaults.model ?? "")
  const [accountId, setAccountId] = useState(defaults.accountId ?? "")
  // 档位和计划开关分开记：计划打开期间档位不变，关掉计划或批准计划后回到这一档。
  // 回到进行中的会话时从监督审批记起：设置里的默认档位只给新会话，不能借计划结束进入完全访问。
  const [level, setLevel] = useState<RuntimeMode>(live ? DEFAULT_PERMISSION_LEVEL : defaultLevel)
  const [draftPlan, setDraftPlan] = useState(false)
  const startedAt = useRef(Date.now())
  const lastModelsError = useRef<string | null>(null)
  const [page, setPage] = useState<HTMLDivElement | null>(null)

  // 同一时间只回答一张卡片；答完后下一张会顶上来。
  const pending = useMemo(() => pendingPermission(state), [state])
  const defaultModel = session.models.find((model) => model.isDefault) ?? session.models[0]
  // 默认模型已不在目录里时用 Claude Code 的默认；目录还没读到时先照用。
  const draftModel =
    session.models.length === 0 || session.models.some((model) => model.id === modelId)
      ? modelId
      : ""
  const selectedModel = state.model ?? (draftModel || defaultModel?.id || "")
  const shown: PermissionView = live
    ? permissionView(state.permissionMode, level)
    : { level, plan: draftPlan }
  // 偏好的账号已从号池删除时按自动选择处理。
  const draftAccount = accounts.some((account) => account.id === accountId) ? accountId : ""
  const activeAccount = live ? (sessionAccountId(session) ?? "") : draftAccount
  const proxyUrls = new Map(proxies.map((proxy) => [proxy.id, proxy.url]))
  const availableAccounts = accounts.filter((account) =>
    isAccountSelectable(
      {
        enabled: account.enabled,
        needsReauth: account.needsReauth,
        hasCredential: account.credentialExpiresAt !== null,
        exhaustedUntil: account.exhaustedUntil,
        // 没有绑定代理时传 null 表示走系统网络；账号菜单和主进程选号器判断一致。
        proxyUrl: account.proxyId === null ? null : proxyUrls.get(account.proxyId),
      },
      Date.now(),
    ),
  )
  const agents = composerAgents(availableAccounts)
  // 会话正在用的账号即使暂时不可选也要留在实例栏里，否则选择器会一直显示加载中。
  if (activeAccount !== "" && !agents.some((agent) => agent.id === activeAccount)) {
    const active = accounts.find((account) => account.id === activeAccount)
    agents.push(active ? composerAgent(active) : currentAccountAgent(activeAccount))
  }
  const catalog = composerCatalog(
    agents,
    session.modelsLoading && session.models.length === 0 ? null : session.models,
  )
  const draftKey = live ? (state.sessionId ?? "session") : (workspace ?? "new-thread")
  const projectName = workspace === null ? "" : projectNameFromPath(workspace)
  const threadId = state.sessionId ?? (workspace === null ? "new-thread" : `draft-${workspace}`)
  // 草稿页只在还没有会话时使用；从草稿发第一条消息后即使导航还没切换，也要显示时间线。
  const showDraft = fresh && !live && state.sessionId === null
  const draft = useDraftWorkspace(
    workbench,
    showDraft ? (workspace ?? workspaceOptions[0] ?? null) : null,
  )

  useEffect(() => {
    if (session.models.length > 0 || session.modelsLoading || session.modelsError !== null) return
    void session.refreshModels()
  }, [session.models.length, session.modelsLoading, session.modelsError, session.refreshModels])

  // 每个新会话都按设置里的默认模型、默认档位和选号偏好开始，计划关闭；上一个会话里选的不带过来。
  useEffect(() => {
    if (live) return
    setLevel(defaultLevel)
    setDraftPlan(false)
    setModelId(defaults.model ?? "")
    setAccountId(defaults.accountId ?? "")
  }, [live, defaultLevel, defaults.model, defaults.accountId])

  // 计划之外的档位只认主进程报告的模式；没生效的选择不能成为计划结束后要回的档位。
  useEffect(() => {
    if (live && !shown.plan) setLevel(shown.level)
  }, [live, shown.plan, shown.level])

  useEffect(() => {
    startedAt.current = Date.now()
  }, [state.sessionId])

  // 模型列表失败只提示一次；重试或状态变化后再次失败会重新提示。
  useEffect(() => {
    const message = session.modelsError
    if (message === null || message === lastModelsError.current) return
    lastModelsError.current = message
    toast(`模型列表不可用：${message}`, "alert")
  }, [session.modelsError, toast])

  /** 每次都弹出提示，同一句话连续出现也不合并。 */
  function notify(message: string): void {
    toast(message, "alert")
  }

  /** 只读列出当前工作区的文件；浏览器预览没有桌面桥时返回空列表。 */
  function files(): Promise<readonly string[]> {
    if (workspace === null) return Promise.resolve([])
    return window.pigclaude?.workspaces?.files?.(workspace) ?? Promise.resolve([])
  }

  /** 切换档位；完全访问的确认框由输入区自己给出。会话开始前和计划打开期间只记住新档位。 */
  function chooseMode(mode: PermissionMode): void {
    const next = composerLevel(mode)
    if (next === null) return
    if (live && !shown.plan) void session.setMode(sessionPermissionMode(next, false))
    else setLevel(next)
  }

  /** 开合计划开关；关掉时回到打开前的档位。 */
  function choosePlan(value: boolean): void {
    if (live) void session.setMode(sessionPermissionMode(level, value))
    else setDraftPlan(value)
  }

  /** 选中模型选择器里的实例和模型；会话开始后换账号仍然不支持。 */
  function chooseModel(choice: ComposerModelChoice): void {
    const nextAccount = accountIdForAgent(choice.instanceId)
    if (live && nextAccount !== activeAccount) {
      notify("会话开始后不支持换号")
      return
    }
    if (!live) setAccountId(nextAccount)
    setModelId(choice.modelId)
    if (live) void session.setModel(choice.modelId)
  }

  const composer: ComposerConfig = {
    agents,
    agentId: agentIdForAccount(activeAccount),
    modelId: selectedModel,
    catalog,
    permissionMode: shown.level,
    onPermissionMode: chooseMode,
    planMode: shown.plan,
    onPlanMode: choosePlan,
    onSelectModel: chooseModel,
    onLoadModels: () => void session.refreshModels(),
    files,
    draftKey,
    smartPunctuation,
  }

  async function startSession(
    target: string,
    project: string,
    effort?: SessionEffort,
    fast?: boolean,
  ): Promise<boolean> {
    const ok = await session.start({
      workspace: target,
      ...(selectedModel === "" ? {} : { model: selectedModel }),
      ...(effort === undefined ? {} : { effort }),
      ...(fast ? { fast: true } : {}),
      permissionMode: sessionPermissionMode(level, draftPlan),
      ...(draftAccount === "" ? {} : { accountId: draftAccount }),
    })
    if (ok) {
      onWorkspaceUsed(target, project)
      if (fresh) onOpen({ kind: "session" })
    }
    return ok
  }

  async function submit(text: string, options: ComposerSubmitOptions): Promise<boolean> {
    const effort = effortForComposer(options.effort)
    if (live) {
      if (state.activeTurnId !== null) {
        notify("当前请求尚未结束")
        return false
      }
      return session.send(text)
    }
    const target = workspace ?? workspaceOptions[0] ?? null
    if (target === null) {
      notify("先选择一个工作区")
      return false
    }
    const directory = await draft.start(target)
    if (directory === null) return false
    const project = (workspace === null ? null : workspaceProject) ?? target
    const ok = await startSession(directory, project, effort, options.fast === true)
    if (!ok) return false
    return session.send(text)
  }

  /** 输入区发送后立即清空；提交失败时把文字放回草稿，避免用户重写。 */
  function submitFromComposer(text: string, options: ComposerSubmitOptions): void {
    const key = draftKey
    void submit(text, options).then((ok) => {
      if (!ok) prefillComposer(key, { text })
    })
  }

  /** 回答一次权限请求；“始终允许”把 SDK 建议的规则一起写回。批准计划时先回到打开计划前的档位。 */
  async function decidePermission(requestId: string, choice: PermissionChoice): Promise<void> {
    const approvesPlan =
      choice.decision === "allow" &&
      shown.plan &&
      pending?.requestId === requestId &&
      pending.toolName === "ExitPlanMode"
    // 顺序不能换：先切档位，回到自动审批时才会经过 Claude Code 核实。
    if (approvesPlan) await session.setMode(sessionPermissionMode(level, false))
    await session.respondPermission(requestId, choice.decision, choice.suggestions)
  }

  function chooseWorkspace(path: string): void {
    onSelectWorkspace(path)
  }

  const view = useMemo(
    () =>
      threadView({
        state,
        threadId,
        workspace,
        projectName,
        instanceId: agentIdForAccount(activeAccount),
        modelId: selectedModel,
        permissionLevel: shown.level,
        planMode: shown.plan,
        startedAt: startedAt.current,
      }),
    [
      state,
      threadId,
      workspace,
      projectName,
      activeAccount,
      selectedModel,
      shown.level,
      shown.plan,
    ],
  )

  if (showDraft) {
    const projects = workspaceOptions.map((path) => ({
      id: path,
      name: projectNameFromPath(path),
      rootPath: path,
    }))
    return (
      <ToolRenderers>
        <NewThreadView
          layoutControls={layoutControls}
          openIn={openIn}
          commands={commands}
          projects={projects}
          projectId={workspaceProject}
          workspaceControls={draft.controls}
          workspaceStatus={draft.status}
          pending={draft.busy}
          onSelectProject={chooseWorkspace}
          onAddProject={onPickWorkspace}
          draftKey={draftKey}
          agents={composer.agents}
          catalog={composer.catalog}
          onLoadModels={composer.onLoadModels}
          agentId={composer.agentId}
          modelId={composer.modelId}
          onSelectModel={composer.onSelectModel}
          permissionMode={composer.permissionMode}
          onPermissionMode={composer.onPermissionMode}
          planMode={composer.planMode}
          onPlanMode={composer.onPlanMode}
          files={composer.files}
          onSubmit={submitFromComposer}
        />
      </ToolRenderers>
    )
  }

  return (
    <div className="chat-page" ref={setPage}>
      <ToolRenderers>
        <ChatView
          layoutControls={layoutControls}
          openIn={openIn}
          commands={commands}
          {...(onOpenFile ? { onOpenFile } : {})}
          {...(onViewDiff ? { onViewDiff } : {})}
          thread={view.thread}
          events={view.events}
          streamingText={view.streamingText}
          liveReasoning={view.liveReasoning}
          {...(workspace === null ? {} : { cwd: workspace })}
          {...(projectName === "" ? {} : { projectName })}
          onStart={submitFromComposer}
          onInterrupt={() => void session.cancel()}
          features={CHAT_FEATURES}
          agents={composer.agents}
          catalog={composer.catalog}
          onLoadModels={composer.onLoadModels}
          onSelectModel={composer.onSelectModel}
          onPermissionMode={composer.onPermissionMode}
          onPlanMode={composer.onPlanMode}
          files={composer.files}
        />
      </ToolRenderers>
      <PermissionDock container={page} mounted={live ? "live" : null}>
        {pending === null ? null : (
          <PermissionPrompt
            request={pending}
            onDecide={(requestId, choice) => void decidePermission(requestId, choice)}
          />
        )}
      </PermissionDock>
    </div>
  )
}
