// 负责把 PigClaude 的最近工作区与当前会话映射成外壳侧栏要的项目、会话与状态点。
// PigClaude 同一时间只有一个会话，它挂在运行它的工作区下；不引入 Pigcode 的线程模型语义。
import type { Project, Thread } from "@pigclaude/pigcode-contracts"
import type { ThreadStatus } from "@pigclaude/pigcode-ui-shell"
import { projectNameFromPath } from "../models/project-model"
import type { SessionUiState } from "../models/session-model"

/** 侧栏不显示项目的创建时间，项目统一用这个占位时间。 */
const UNDATED = "1970-01-01T00:00:00.000Z"

/** 会话标题最多取首条消息的这么多个字符。 */
const TITLE_LIMIT = 40

/** 最近工作区 → 侧栏项目；顺序不变，路径就是项目 id。 */
export function workspaceProjects(paths: readonly string[]): Project[] {
  return paths.map((path) => ({
    id: path,
    rootPath: path,
    name: projectNameFromPath(path) || path,
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

/** 侧栏状态点：等待许可、回复中、出错结束，其余为空闲。 */
export function sessionStatus(session: SessionUiState): ThreadStatus {
  const active = session.turns.find((turn) => turn.id === session.activeTurnId)
  if (active?.permissions.some((card) => card.status === "pending")) return "waiting-approval"
  if (session.activeTurnId !== null && !session.ended) return "running"
  if (session.ended && session.endedReason === "error") return "failed"
  return "idle"
}

/**
 * 当前会话 → 侧栏里的一个会话。还没有开始、或者不知道运行在哪个工作区时返回 null；
 * startedAt 是这个会话第一次出现的时间，侧栏据此显示相对时间。
 */
export function sessionThread({
  session,
  workspace,
  startedAt,
  untitled,
}: {
  session: SessionUiState
  workspace: string | null
  startedAt: string
  untitled: string
}): Thread | null {
  if (!session.sessionId || !workspace) return null
  return {
    id: session.sessionId,
    projectId: workspace,
    title: sessionTitle(session, untitled),
    defaultAgentId: "claude",
    defaultInstanceId: null,
    lastAgentId: null,
    lastInstanceId: null,
    lastModelId: session.model,
    permissionMode: threadPermissionMode(session.permissionMode),
    createdAt: startedAt,
    updatedAt: startedAt,
    archivedAt: null,
    lastRunId: null,
  }
}

/** 把 Claude 会话的权限名称映射成 Pigcode 线程显示模型的四种权限。 */
function threadPermissionMode(mode: SessionUiState["permissionMode"]): Thread["permissionMode"] {
  if (mode === "bypassPermissions") return "danger-full-access"
  if (mode === "acceptEdits") return "workspace-write"
  if (mode === "plan") return "plan"
  return "read-only"
}

/** 侧栏会话行的 Agent 显示名。 */
export const agentNames: Readonly<Record<string, string>> = { claude: "Claude Code" }

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
