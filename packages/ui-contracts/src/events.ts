/** 定义持久线程事件、规范化 Agent 事件和订阅快照。 */
import { z } from "zod"

/** 持久线程事件的类型枚举。 */
export const threadEventTypeSchema = z.enum([
  "thread.created",
  "thread.updated",
  "session.started",
  "run.queued",
  "run.started",
  "run.completed",
  "run.failed",
  "run.interrupted",
  "message.completed",
  "reasoning.completed",
  "tool.started",
  "tool.completed",
  "approval.requested",
  "approval.resolved",
  "question.requested",
  "question.answered",
  "plan.updated",
  "notice",
  "file.changed",
  "usage.updated",
  "context.updated",
  "subagent.started",
  "subagent.completed",
  "workflow.updated",
  "checkpoint.created",
  "plugin.changed",
])

/** 持久化到事件日志的线程事件，seq 在单个线程内单调递增。 */
export const threadEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  threadId: z.string().min(1),
  runId: z.string().nullable(),
  type: threadEventTypeSchema,
  payload: z.unknown(),
  schemaVersion: z.literal(1),
  createdAt: z.string().datetime(),
})

/** 工作流里一个 agent 的状态：排队、运行中、完成、失败。 */
export const workflowAgentStateSchema = z.enum(["queued", "running", "done", "failed"])

/** 工作流里的一个 agent。 */
export const workflowAgentSchema = z.object({
  /** 在工作流里的序号，从 1 开始。 */
  index: z.number().int(),
  /** 脚本给它起的标签，例如 review:math.js。 */
  label: z.string(),
  /** 所属阶段的标题。 */
  phase: z.string().optional(),
  state: workflowAgentStateSchema,
  model: z.string().optional(),
  /** 交给它的任务开头一段。 */
  prompt: z.string().optional(),
  /** 运行中最近一次在做的事：工具名与对象。 */
  activity: z.string().optional(),
  tokens: z.number().optional(),
  toolCalls: z.number().optional(),
  durationMs: z.number().optional(),
  /** 完成后交回的结果开头一段。 */
  result: z.string().optional(),
})

/** 工作流的整体状态。 */
export const workflowStatusSchema = z.enum(["running", "completed", "failed", "stopped"])

/**
 * 一个工作流（Claude Code 的 Workflow 工具，Ultracode 打开时会用）的快照：每次有变化时发一份完整的，
 * 界面按 toolCallId 合并，后到的字段覆盖先到的。script 只在第一份里带。
 */
export const workflowSnapshotSchema = z.object({
  /** 发起它的 Workflow 工具调用。 */
  toolCallId: z.string(),
  taskId: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  /** 工作流脚本。 */
  script: z.string().optional(),
  status: workflowStatusSchema,
  phases: z.array(z.object({ index: z.number().int(), title: z.string() })),
  agents: z.array(workflowAgentSchema),
  usage: z
    .object({
      tokens: z.number().optional(),
      toolCalls: z.number().optional(),
      durationMs: z.number().optional(),
    })
    .optional(),
  /** 结束时的说明，失败时是原因。 */
  summary: z.string().optional(),
  parentToolUseId: z.string().optional(),
})

/** 持久线程事件的类型。 */
export type ThreadEvent = z.infer<typeof threadEventSchema>

export type WorkflowSnapshot = z.infer<typeof workflowSnapshotSchema>

export type WorkflowAgent = z.infer<typeof workflowAgentSchema>

export type WorkflowStatus = z.infer<typeof workflowStatusSchema>
