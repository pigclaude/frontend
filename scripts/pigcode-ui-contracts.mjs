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
  "src/agents.ts": [
    "localizedTextSchema",
    "agentPermissionModeSchema",
    "agentExecutionModesSchema",
    "AgentPermissionMode",
    "AgentExecutionModes",
    "LocalizedText",
    "AgentCliUpdateState",
    "localizeText",
  ],
  "src/runtime-modes.ts": ["runtimeModeSchema", "RuntimeMode", "DEFAULT_RUNTIME_MODE"],
  "src/runtime-mode-options.ts": ["RUNTIME_MODE_OPTIONS"],
  "src/locale/runtime-modes.ts": ["runtimeModeMessages"],
  "src/updates.ts": ["DesktopUpdateState"],
}

/** 原文件与目标文件的范围。错误码与上游 RPC 信封共享文件，拷入时单独命名。 */
export const contractFiles = {
  "src/domain.ts": "src/domain.ts",
  "src/events.ts": "src/events.ts",
  "src/protocol.ts": "src/error-codes.ts",
  "src/agents.ts": "src/agents.ts",
  "src/runtime-modes.ts": "src/runtime-modes.ts",
  "src/runtime-mode-options.ts": "src/runtime-mode-options.ts",
  "src/locale/runtime-modes.ts": "src/locale/runtime-modes.ts",
  "src/updates.ts": "src/updates.ts",
}

/** 合约包只公开拷入界面包用到的类型、运行时常量和已知错误码判定。 */
export const contractEntry = `/** 界面依赖的 Pigcode 数据类型、运行时常量和错误码。 */
export type {
  AgentCommand, AgentFeatures, KnownReasoningEffort, PermissionMode, Project, ReasoningEffort,
  PullRequestInfo, ScheduleRule, ScheduleRunStatus, ScheduleStatus, Thread,
} from "./domain"
export type { ThreadEvent, WorkflowAgent, WorkflowSnapshot, WorkflowStatus } from "./events"
export { HOST_ERROR_CODES, isHostErrorCode, type HostErrorCode } from "./error-codes"
export {
  agentExecutionModesSchema, localizeText, type AgentCliUpdateState, type AgentExecutionModes,
  type AgentPermissionMode, type LocalizedText,
} from "./agents"
export { DEFAULT_RUNTIME_MODE, type RuntimeMode } from "./runtime-modes"
export { RUNTIME_MODE_OPTIONS } from "./runtime-mode-options"
export type { DesktopUpdateState } from "./updates"
`

/** 保留所选顶层声明的原文和注释，删掉所选声明用不到的导入。上游删除或重命名声明时中止同步。 */
export function projectUiContracts(source, path) {
  const wanted = new Set(declarations[path])
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false)
  const imports = []
  const selected = []
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && path !== "src/protocol.ts") {
      imports.push(statement)
      continue
    }
    const name = ts.isVariableStatement(statement)
      ? statement.declarationList.declarations[0]?.name
      : statement.name
    if (name && ts.isIdentifier(name) && wanted.delete(name.text)) selected.push(statement)
  }
  if (wanted.size) throw new Error(`${path} 缺少 Pigcode 界面需要的声明：${[...wanted].join(", ")}`)
  const used = new Set()
  const collect = (node) => {
    if (ts.isIdentifier(node)) used.add(node.text)
    ts.forEachChild(node, collect)
  }
  for (const statement of selected) collect(statement)
  const parts = imports.flatMap((statement) => usedImport(statement, file, used))
  for (const statement of selected) parts.push(statement.getFullText(file).trim())
  return `${parts.join("\n\n")}\n`
}

/** 只保留被引用的具名导入；全部用到时保留原文，一个都没用到时整条删掉。 */
function usedImport(statement, file, used) {
  const original = statement.getFullText(file).trim()
  const clause = statement.importClause
  const bindings = clause?.namedBindings
  if (!clause || clause.name || !bindings || !ts.isNamedImports(bindings)) return [original]
  const kept = bindings.elements.filter((element) => used.has(element.name.text))
  if (kept.length === bindings.elements.length) return [original]
  if (kept.length === 0) return []
  const names = kept.map((element) => element.getText(file)).join(", ")
  const typeOnly = clause.isTypeOnly ? "type " : ""
  return [`import ${typeOnly}{ ${names} } from ${statement.moduleSpecifier.getText(file)}`]
}
