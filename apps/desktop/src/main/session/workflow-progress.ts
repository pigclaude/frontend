// 负责读出工作流的进度和脚本元数据：任务进度消息里的 workflow_progress（阶段和各个 agent）不在 SDK
// 的类型里，逐项校验着读，认不出的字段跳过；工作流脚本里 meta 的名字和说明只认字面量写法。

import type { WorkflowAgent, WorkflowSnapshot } from "@pigclaude/ui-contracts"

/** 工作流进度里的阶段和 agent，各按序号排好。 */
export type WorkflowProgress = Pick<WorkflowSnapshot, "phases" | "agents">

/** 读出任务进度消息里完整的阶段和 agent 清单；消息不带清单时返回 null。 */
export function readWorkflowProgress(message: object): WorkflowProgress | null {
  const value = (message as { workflow_progress?: unknown }).workflow_progress
  if (!Array.isArray(value)) return null
  const phases: WorkflowSnapshot["phases"] = []
  const agents: WorkflowAgent[] = []
  for (const item of value) {
    const raw = record(item)
    const index = count(raw?.index)
    if (raw === null || index === undefined) continue
    if (raw.type === "workflow_phase") {
      const title = text(raw.title)
      if (title !== undefined) phases.push({ index, title })
    } else if (raw.type === "workflow_agent") {
      agents.push(readAgent(raw, index))
    }
  }
  phases.sort((left, right) => left.index - right.index)
  agents.sort((left, right) => left.index - right.index)
  return { phases, agents }
}

/** 从工作流脚本的 `export const meta = { name: '…', description: '…' }` 取名字和说明；取不到的项省略。 */
export function readScriptMeta(
  script: string | undefined,
): Pick<WorkflowSnapshot, "name" | "description"> {
  if (script === undefined) return {}
  const meta = /export\s+const\s+meta\s*=\s*\{([\s\S]*?)\n\}/.exec(script)?.[1] ?? ""
  const field = (key: string): string | undefined =>
    new RegExp(`\\b${key}\\s*:\\s*(['"\`])((?:\\\\.|(?!\\1).)*)\\1`).exec(meta)?.[2]
  return withoutUndefined({ name: field("name"), description: field("description") })
}

function readAgent(raw: Record<string, unknown>, index: number): WorkflowAgent {
  return withoutUndefined({
    index,
    label: text(raw.label) ?? `#${index}`,
    phase: text(raw.phaseTitle),
    state: stateOf(raw),
    model: text(raw.model),
    prompt: text(raw.promptPreview),
    activity: activityOf(raw),
    tokens: count(raw.tokens),
    toolCalls: count(raw.toolCalls),
    durationMs: count(raw.durationMs),
    result: text(raw.resultPreview),
  })
}

/** 去掉值为 undefined 的键，快照里只留有值的字段。 */
export function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

// CLI 的 agent 状态是 start（排队或刚开始）、progress、done，失败时是 error 一类。
function stateOf(raw: Record<string, unknown>): WorkflowAgent["state"] {
  const state = text(raw.state)
  if (state === "done") return "done"
  if (state === "error" || state === "failed" || state === "cancelled" || state === "killed") {
    return "failed"
  }
  if (state === "start" && raw.startedAt === undefined) return "queued"
  return "running"
}

function activityOf(raw: Record<string, unknown>): string | undefined {
  const tool = text(raw.lastToolName)
  if (tool === undefined) return undefined
  const subject = text(raw.lastToolSummary)
  return subject === undefined ? tool : `${tool} ${subject}`
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}
