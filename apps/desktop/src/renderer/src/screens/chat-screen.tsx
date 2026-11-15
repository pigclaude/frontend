// 负责聊天页：草稿选工作区、分支和 worktree，开始会话、时间线、工具/终端/浏览器视图、权限回答、
// 时间线里的提问卡、线程头的子代理标签、换号提示和错误。
// 页面只消费 useSession 控制器，界面完全由 Pigcode 的 ui-chat 绘制。

import { useEffect, useMemo, useRef, useState } from "react"
import { isAccountSelectable } from "@pigclaude/contracts/claude-account"
import type { AgentFeatures, RuntimeMode } from "@pigclaude/ui-contracts"
import { ChatView } from "@pigclaude/ui-chat"
import {
  captureComposerDraft,
  type ComposerModelChoice,
  type ComposerSubmitOptions,
  type PermissionMode,
} from "@pigclaude/ui-composer"
import { useToast } from "@pigclaude/ui-shell"
import { PermissionDock } from "../components/permission-dock"
import { PermissionPrompt, type PermissionChoice } from "../components/permission-prompt"
import { ToolRenderers } from "../components/tool-renderers"
import { sessionAccountId } from "../hooks/use-session"
import { useComposerReference } from "../hooks/use-composer-reference"
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
import { pendingPermission, waitingSubagents } from "../models/session-permissions"
import { useSubagentTabs } from "../hooks/use-subagent-tabs"
import { threadView } from "../models/thread-view"
import type { SessionEffort } from "../../../main/session/session-types"
import { useSlashCommands } from "../shell/registry-slash-commands"
import { useSessionDefaults } from "../hooks/use-session-defaults"
import { needsSessionResume } from "../models/saved-session"
import { SessionResumeError } from "./session-resume-error"
import type { SessionErrorView } from "../models/session-errors"
import { useText } from "../locale/text"
import { ChatDraft } from "./chat-draft"
import type { ChatScreenProps } from "./chat-screen-props"
import { useDraftWorkspace } from "./draft-workspace"

/** 保留聊天页的公开属性类型。 */
export type { ChatScreenProps } from "./chat-screen-props"

/** Claude 会话支持的 Agent 功能；界面据此显示计划、中断和审批等控件。 */
const CLAUDE_FEATURES: AgentFeatures = {
  streaming: true,
  approvals: true,
  questions: true,
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
  onProjectConfiguration,
  onWorkspaceUsed,
  identifySessions = false,
  projectDraft,
  summary,
  onRecoverReference,
  onDraftOpened,
  referenceRequest,
  threadOptions = [],
  onOpen,
  smartPunctuation,
  layoutControls,
  openIn,
  onOpenFile,
  onViewDiff,
  workbench,
}: ChatScreenProps) {
  const toast = useToast()
  const { t } = useText()
  const commands = useSlashCommands()
  const { state } = session
  const parked = needsSessionResume(summary)
  const live = state.started && !state.ended && !parked
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
  const [resumeError, setResumeError] = useState<SessionErrorView | null>(null)
  const submitting = useRef(false)

  // 同一时间只回答一张卡片；答完后下一张会顶上来。
  const pending = useMemo(() => pendingPermission(state), [state])
  const defaultModel = session.models.find((model) => model.isDefault) ?? session.models[0]
  // 默认模型已不在目录里时用 Claude Code 的默认；目录还没读到时先照用。
  const chosenModelId = projectDraft
    ? (projectDraft.draft.modelId ?? defaults.model ?? "")
    : modelId
  const draftModel =
    session.models.length === 0 || session.models.some((model) => model.id === chosenModelId)
      ? chosenModelId
      : ""
  const selectedModel = state.model ?? (draftModel || defaultModel?.id || "")
  const draftLevel = projectDraft?.draft.level ?? (projectDraft ? defaultLevel : level)
  const plan = projectDraft?.draft.plan ?? draftPlan
  const shown: PermissionView = live
    ? permissionView(state.permissionMode, level)
    : { level: draftLevel, plan }
  // 偏好的账号已从号池删除时按自动选择处理。
  const pickedAccount =
    projectDraft?.draft.accountId ?? (projectDraft ? (defaults.accountId ?? "") : accountId)
  const draftAccount = accounts.some((account) => account.id === pickedAccount) ? pickedAccount : ""
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
  const projectName = workspace === null ? "" : projectNameFromPath(workspace)
  const threadId = state.sessionId ?? (workspace === null ? "new-thread" : `draft-${workspace}`)
  // 草稿页只在还没有会话时使用；从草稿发第一条消息后即使导航还没切换，也要显示时间线。
  const showDraft = fresh && !live && state.sessionId === null
  const draftKey = showDraft ? (projectDraft?.key ?? workspaceProject ?? "new-thread") : threadId
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
    else if (!live && projectDraft) projectDraft.update({ level: next })
    else setLevel(next)
  }

  /** 开合计划开关；关掉时回到打开前的档位。 */
  function choosePlan(value: boolean): void {
    if (live) void session.setMode(sessionPermissionMode(level, value))
    else if (projectDraft) projectDraft.update({ plan: value })
    else setDraftPlan(value)
  }

  /** 选中模型选择器里的实例和模型；会话开始后换账号仍然不支持。 */
  function chooseModel(choice: ComposerModelChoice): void {
    const nextAccount = accountIdForAgent(choice.instanceId)
    if (live && nextAccount !== activeAccount) {
      notify("会话开始后不支持换号")
      return
    }
    if (!live && projectDraft)
      projectDraft.update({ accountId: nextAccount, modelId: choice.modelId })
    else {
      if (!live) setAccountId(nextAccount)
      setModelId(choice.modelId)
    }
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
    sessionId?: string,
  ): Promise<boolean> {
    const input = {
      ...(sessionId === undefined ? {} : { sessionId, projectPath: project }),
      workspace: target,
      ...(selectedModel === "" ? {} : { model: selectedModel }),
      ...(effort === undefined ? {} : { effort }),
      ...(fast ? { fast: true } : {}),
      permissionMode: sessionPermissionMode(draftLevel, plan),
      ...(draftAccount === "" ? {} : { accountId: draftAccount }),
    }
    const ok = await (projectDraft
      ? session.start(input, (error) => projectDraft.update({ error }))
      : session.start(input))
    if (projectDraft && !projectDraft.isCurrent()) return false
    if (ok) {
      if (sessionId === undefined) onWorkspaceUsed(target, project)
      else onWorkspaceUsed(target, project, sessionId)
      if (onDraftOpened === undefined && (fresh || sessionId !== undefined))
        onOpen({ kind: "session", ...(sessionId === undefined ? {} : { sessionId }) })
    }
    return ok
  }

  async function submit(text: string, options: ComposerSubmitOptions): Promise<boolean> {
    const effort = effortForComposer(options.effort)
    const fast = options.fast === true
    const references = text.startsWith("/") ? undefined : options.references
    const referenceOptions = references?.length ? { references } : undefined
    const sendOptions = { effort: effort ?? null, fast, ...referenceOptions }
    if (live) {
      if (state.activeTurnId !== null) {
        notify("当前请求尚未结束")
        return false
      }
      return session.send(text, sendOptions)
    }
    if (identifySessions && state.sessionId !== null) {
      if (parked)
        return session.send(text, referenceOptions, summary ?? state.sessionId, setResumeError)
      if (summary?.status === "queued" || summary?.status === "running") return false
      notify(t("shell.session.parked"))
      return false
    }
    const target = workspace ?? workspaceOptions[0] ?? null
    if (target === null) {
      notify("先选择一个工作区")
      return false
    }
    const directory = await draft.start(target)
    if (directory === null || (projectDraft && !projectDraft.isCurrent())) return false
    const project = (workspace === null ? null : workspaceProject) ?? target
    const sessionId = identifySessions ? crypto.randomUUID() : undefined
    const ok = await startSession(directory, project, effort, fast, sessionId)
    if (!ok) return false
    if (sessionId === undefined) return session.send(text, sendOptions)
    const sent = await session.send(text, sendOptions, sessionId, ({ message }) =>
      projectDraft?.update({ error: message }),
    )
    if (sent && (projectDraft?.isCurrent() ?? true)) onDraftOpened?.(sessionId, project)
    return sent
  }

  /** 输入区发送后立即清空；提交失败时恢复原来的文档与附件。 */
  function submitFromComposer(text: string, options: ComposerSubmitOptions): void {
    if (submitting.current) return
    submitting.current = true
    setResumeError(null)
    if (fresh) projectDraft?.update({ pending: true, error: null })
    const restoreDraft = captureComposerDraft(draftKey)
    void submit(text, options)
      .then((ok) => {
        if (!ok && (projectDraft?.isCurrent() ?? true)) restoreDraft(draftKey)
      })
      .finally(() => {
        submitting.current = false
        if (fresh) projectDraft?.update({ pending: false })
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
  const waiting = useMemo(() => waitingSubagents(state), [state])
  const subagentTabs = useSubagentTabs({
    sessionId: state.sessionId,
    events: view.events,
    main: {
      title: view.thread.title,
      description: projectName === "" ? view.thread.title : `${projectName} / ${view.thread.title}`,
    },
    waiting,
  })
  const draftReady =
    workspaceProject !== null &&
    workspaceOptions.includes(workspaceProject) &&
    !draft.busy &&
    !projectDraft?.draft.pending
  useComposerReference(
    referenceRequest,
    !showDraft || draftReady,
    subagentTabs.subagent ? subagentTabs.onBackToMain : undefined,
  )

  if (showDraft) {
    return (
      <ChatDraft
        composer={composer}
        workspace={draft}
        projectDraft={projectDraft}
        projects={workspaceOptions}
        projectId={workspaceProject}
        {...(workspace && onProjectConfiguration
          ? { configuration: { path: workspace, open: onProjectConfiguration } }
          : {})}
        commands={commands}
        threads={threadOptions}
        openIn={openIn}
        layoutControls={layoutControls}
        onSelectProject={onSelectWorkspace}
        onAddProject={onPickWorkspace}
        onSubmit={submitFromComposer}
      />
    )
  }

  return (
    <div className="chat-page" ref={setPage}>
      {resumeError ? (
        <SessionResumeError
          error={resumeError}
          onRecover={
            summary && onRecoverReference
              ? () => onRecoverReference(summary, resumeError.code === "WORKSPACE_UNAVAILABLE")
              : undefined
          }
        />
      ) : null}
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
          {...subagentTabs}
          {...(workspace === null ? {} : { cwd: workspace })}
          {...(projectName === "" ? {} : { projectName })}
          onStart={submitFromComposer}
          onInterrupt={() => void session.cancel()}
          onAnswer={(requestId, answers) => void session.answerQuestion(requestId, answers)}
          features={CHAT_FEATURES}
          agents={composer.agents}
          catalog={composer.catalog}
          onLoadModels={composer.onLoadModels}
          onSelectModel={composer.onSelectModel}
          onPermissionMode={composer.onPermissionMode}
          onPlanMode={composer.onPlanMode}
          files={composer.files}
          threads={threadOptions}
        />
      </ToolRenderers>
      {/* 还没有一轮时对话组件显示问候页，没有输入区容器；第一轮出现后要重新挂上。 */}
      <PermissionDock container={page} mounted={live ? `live-${state.turns.length > 0}` : null}>
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
