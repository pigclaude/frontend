// 负责把最近工作区、会话摘要和本机收到的会话事件映射成外壳侧栏要的项目、会话和状态点。
import type { Project, Thread } from "@pigclaude/ui-contracts"
import type { ThreadStatus } from "@pigclaude/ui-shell"
import { DEFAULT_PERMISSION_LEVEL, permissionView } from "../models/composer-config"
import { projectNameFromPath } from "../models/project-model"
import type { SessionUiState } from "../models/session-model"
import { sessionState, type SessionCollection } from "../models/session-collection"
import { pendingPermission } from "../models/session-permissions"
import type { SessionSummary } from "../../../main/session/session-summary"

/** 侧栏不显示项目的创建时间，项目统一用这个占位时间。 */
const UNDATED = "1970-01-01T00:00:00.000Z"

/** 会话标题最多取首条消息的这么多个字符。 */
const TITLE_LIMIT = 40

/** 最近工作区 → 侧栏项目；顺序不变，路径就是项目 id，改过名的项目用侧栏显示名。 */
export function workspaceProjects(
  paths: readonly string[],
  names: Readonly<Record<string, string>> = {},
): Project[] {
  return paths.map((path) => ({
    id: path,
    rootPath: path,
    name: names[path] || projectNameFromPath(path) || path,
    createdAt: UNDATED,
  }))
}

/** 会话标题：首条用户消息的第一行，过长时截断；还没有消息时用 untitled。 */
export function sessionTitle(session: Pick<SessionUiState, "turns">, untitled: string): string {
  const first = session.turns.find((turn) => turn.userText?.trim())?.userText ?? ""
  const line = first.trim().split("\n")[0]?.trim() ?? ""
  if (!line) return untitled
  const chars = [...line]
  return chars.length > TITLE_LIMIT ? `${chars.slice(0, TITLE_LIMIT).join("")}…` : line
}

/**
 * 侧栏状态点：等待许可、回复中；回合结束后按最后一轮显示已完成、失败或已中断；
 * 会话出错结束时失败，还没有回合时空闲。子代理忙时主进程不结束这一轮，
 * 所以主会话显示运行中；主线程和子代理的权限询问都算等待许可。
 */
export function sessionStatus(session: SessionUiState): ThreadStatus {
  if (session.activeTurnId !== null && !session.ended) {
    return pendingPermission(session) === null ? "running" : "waiting-approval"
  }
  if (session.ended && session.endedReason === "error") return "failed"
  const last = session.turns.at(-1)?.status
  if (last === "done") return "completed"
  if (last === "error") return "failed"
  if (last === "cancelled") return "interrupted"
  return "idle"
}

/** 会话行账号角标用到的账号字段；只有显示名，不含凭据和代理。 */
export type BadgeAccount = { id: string; displayName: string }

/** 工作区侧栏要展示的会话与即时状态，摘要负责补齐还没收到信封的会话。 */
export function workspaceThreads(input: {
  summaries: readonly SessionSummary[]
  states: SessionCollection
  workspaces: ReadonlyMap<string, string>
  projectOf: (workspace: string) => string | null
  untitled: string
  accounts: readonly BadgeAccount[]
}): { threads: Thread[]; statuses: Record<string, ThreadStatus> } {
  const summaries = new Map(input.summaries.map((item) => [item.sessionId, item]))
  const ids = new Set([...summaries.keys(), ...input.workspaces.keys()])
  const threads: Thread[] = []
  const statuses: Record<string, ThreadStatus> = {}
  for (const id of ids) {
    const summary = summaries.get(id)
    const workspace = summary?.workspace ?? input.workspaces.get(id)
    if (workspace === undefined) continue
    const state = sessionState(input.states, id)
    const record = state.events[id]
    const at =
      summary?.lastActivityAt ?? record?.envelopes.at(-1)?.at ?? state.turns.at(-1)?.startedAt
    const thread = sessionThread({
      session: {
        ...state,
        sessionId: id,
        accountId: state.accountId ?? summary?.accountId ?? null,
        model: state.model ?? summary?.model ?? null,
      },
      workspace: input.projectOf(workspace),
      startedAt: at ?? UNDATED,
      untitled: input.untitled,
      accounts: input.accounts,
    })
    if (thread === null) continue
    threads.push(thread)
    statuses[id] = summaryStatus(summary, state)
  }
  threads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return { threads, statuses }
}

function summaryStatus(summary: SessionSummary | undefined, state: SessionUiState): ThreadStatus {
  if (summary?.status === "failed" || summary?.status === "interrupted") return summary.status
  const live = sessionStatus(state)
  if (state.activeTurnId !== null || state.ended) return live
  if (summary !== undefined) {
    if (summary.status !== "idle" && summary.status !== "parked") return summary.status
    if (summary.lastTurn === "completed") return "completed"
    if (summary.lastTurn === "error") return "failed"
    if (summary.lastTurn === "interrupted") return "interrupted"
  }
  return live
}

/**
 * 当前会话 → 侧栏里的一个会话。还没有开始、或者不知道运行在哪个工作区时返回 null；
 * startedAt 是这个会话第一次出现的时间，侧栏据此显示相对时间。
 * 实例 id 是会话实际在用的账号，换号后跟着变；账号不在号池里时不带角标。
 */
export function sessionThread({
  session,
  workspace,
  startedAt,
  untitled,
  accounts,
}: {
  session: SessionUiState
  workspace: string | null
  startedAt: string
  untitled: string
  accounts: readonly BadgeAccount[]
}): Thread | null {
  if (!session.sessionId || !workspace) return null
  const permission = permissionView(session.permissionMode, DEFAULT_PERMISSION_LEVEL)
  const account = accounts.find((item) => item.id === session.accountId)
  return {
    id: session.sessionId,
    projectId: workspace,
    title: sessionTitle(session, untitled),
    defaultAgentId: "claude",
    defaultInstanceId: null,
    lastAgentId: "claude",
    lastInstanceId: account?.id ?? null,
    lastModelId: session.model,
    permissionMode: permission.level,
    planMode: permission.plan,
    createdAt: startedAt,
    updatedAt: startedAt,
    archivedAt: null,
    lastRunId: null,
  }
}

/** 侧栏会话行的 Agent 与账号显示名，按 id；账号角标由显示名得出。 */
export function sessionAgentNames(accounts: readonly BadgeAccount[]): Record<string, string> {
  return {
    claude: "Claude Code",
    ...Object.fromEntries(accounts.map((account) => [account.id, account.displayName])),
  }
}

/** 折叠或展开一个项目：只改这一个项目的展开状态。 */
export function toggleExpanded(
  expanded: Readonly<Record<string, boolean>>,
  projectId: string,
  open: boolean,
): Record<string, boolean> {
  return { ...expanded, [projectId]: open }
}

/** 从项目新建会话时用哪个工作区：项目是已知工作区时用它，否则沿用 current。 */
export function newSessionWorkspace(
  projectId: string | undefined,
  workspaces: readonly string[],
  current: string | null,
): string | null {
  return projectId !== undefined && workspaces.includes(projectId) ? projectId : current
}
