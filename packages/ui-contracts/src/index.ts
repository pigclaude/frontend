/** 界面依赖的 Pigcode 数据类型和错误码。 */
export type {
  AgentCommand,
  AgentFeatures,
  KnownReasoningEffort,
  PermissionMode,
  Project,
  ReasoningEffort,
  ScheduleRule,
  ScheduleRunStatus,
  ScheduleStatus,
  Thread,
} from "./domain"
export type { ThreadEvent, WorkflowAgent, WorkflowSnapshot, WorkflowStatus } from "./events"
export { HOST_ERROR_CODES, isHostErrorCode, type HostErrorCode } from "./error-codes"
