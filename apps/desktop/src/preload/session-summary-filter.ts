// 负责在 preload 校验主进程返回的会话列表摘要，只把字段齐全、状态在集合里的摘要交给渲染层。

import type { SessionListStatus, SessionSummary } from "../main/session/session-summary"

const statuses = new Set<SessionListStatus>([
  "queued",
  "running",
  "waiting-approval",
  "idle",
  "parked",
  "interrupted",
  "failed",
])
const turnEnds = new Set(["completed", "error", "interrupted"])

/** 判断一个值是不是完整的会话摘要；状态和上一轮结果只认已登记的取值。 */
export function isSessionSummary(value: unknown): value is SessionSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.sessionId === "string" &&
    typeof record.workspace === "string" &&
    typeof record.status === "string" &&
    statuses.has(record.status as SessionListStatus) &&
    (record.lastTurn === null ||
      (typeof record.lastTurn === "string" && turnEnds.has(record.lastTurn))) &&
    (record.turnId === null || typeof record.turnId === "string") &&
    isCount(record.pendingPermissions) &&
    isCount(record.pendingQuestions) &&
    (record.accountId === null || typeof record.accountId === "string") &&
    (record.model === null || typeof record.model === "string") &&
    typeof record.lastActivityAt === "string"
  )
}

function isCount(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value)
}
