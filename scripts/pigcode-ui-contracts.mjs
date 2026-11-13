// 负责从固定 Pigcode 合约文件选出界面用到的声明及其类型依赖。
import ts from "typescript"

const declarations = {
  "src/domain.ts": [
    "agentFeaturesSchema",
    "permissionModeSchema",
    "knownReasoningEfforts",
    "reasoningEffortSchema",
    "agentCommandSchema",
    "projectSchema",
    "threadSchema",
    "pullRequestStateSchema",
    "pullRequestInfoSchema",
    "MAX_SCHEDULE_EVERY",
    "clockTimeSchema",
    "minuteSchema",
    "weekdaySchema",
    "weekdaysSchema",
    "monthDaySchema",
    "everySchema",
    "anchorSchema",
    "scheduleRuleSchema",
    "scheduleStatusSchema",
    "scheduleRunStatusSchema",
    "AgentFeatures",
    "PermissionMode",
    "ReasoningEffort",
    "KnownReasoningEffort",
    "AgentCommand",
    "Project",
    "Thread",
    "PullRequestInfo",
    "ScheduleRule",
    "ScheduleStatus",
    "ScheduleRunStatus",
  ],
  "src/events.ts": [
    "threadEventTypeSchema",
    "threadEventSchema",
    "workflowAgentStateSchema",
    "workflowAgentSchema",
    "workflowStatusSchema",
    "workflowSnapshotSchema",
    "ThreadEvent",
    "WorkflowSnapshot",
    "WorkflowAgent",
    "WorkflowStatus",
  ],
  "src/protocol.ts": ["HOST_ERROR_CODES", "HostErrorCode", "isHostErrorCode"],
}

/** 原文件与目标文件的范围。错误码与上游 RPC 信封共享文件，拷入时单独命名。 */
export const contractFiles = {
  "src/domain.ts": "src/domain.ts",
  "src/events.ts": "src/events.ts",
  "src/protocol.ts": "src/error-codes.ts",
}

/** 合约包只公开 UI 类型和已知错误码判定。 */
export const contractEntry = `/** 界面依赖的 Pigcode 数据类型和错误码。 */
export type {
  AgentCommand, AgentFeatures, KnownReasoningEffort, PermissionMode, Project, ReasoningEffort,
  PullRequestInfo, ScheduleRule, ScheduleRunStatus, ScheduleStatus, Thread,
} from "./domain"
export type { ThreadEvent, WorkflowAgent, WorkflowSnapshot, WorkflowStatus } from "./events"
export { HOST_ERROR_CODES, isHostErrorCode, type HostErrorCode } from "./error-codes"
`

/** 保留所选顶层声明的原文和注释。上游删除或重命名声明时中止同步。 */
export function projectUiContracts(source, path) {
  const wanted = new Set(declarations[path])
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false)
  const parts = []
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && path !== "src/protocol.ts") {
      parts.push(statement.getFullText(file).trim())
      continue
    }
    const name = ts.isVariableStatement(statement)
      ? statement.declarationList.declarations[0]?.name
      : statement.name
    if (name && ts.isIdentifier(name) && wanted.delete(name.text)) {
      parts.push(statement.getFullText(file).trim())
    }
  }
  if (wanted.size) throw new Error(`${path} 缺少 Pigcode 界面需要的声明：${[...wanted].join(", ")}`)
  return `${parts.join("\n\n")}\n`
}
