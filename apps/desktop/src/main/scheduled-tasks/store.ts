// 校验本机定时任务文件并原子替换，原文件在写失败时保持可读。

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, isAbsolute } from "node:path"
import { scheduleRuleSchema } from "@pigclaude/ui-contracts"
import { z } from "zod"
import type { ScheduledTaskInput } from "../../scheduled-tasks-contract"

/** 每个任务最多保留的触发记录数，包含正在运行的一条记录。 */
export const maximumScheduledTaskRuns = 50

const id = z.string().min(1)
const timestamp = z.iso.datetime()
const optionalTime = timestamp.nullable()
const rule = z.unknown().transform((input, ctx) => {
  const valid = scheduleRuleSchema.safeParse(input)
  if (!valid.success) {
    ctx.addIssue({ code: "custom", message: "SCHEDULE_RULE_INVALID" })
    return z.NEVER
  }
  if (valid.data.kind === "everyMinutes" && valid.data.every < 15) {
    ctx.addIssue({ code: "custom", message: "SCHEDULE_INTERVAL_TOO_SHORT" })
    return z.NEVER
  }
  return valid.data
})
const taskInput = z.object({
  projectPath: z.string().refine((path) => isAbsolute(path) && !path.includes("\0")),
  prompt: z.string().refine((text) => text.trim().length > 0),
  rule,
  endsAt: optionalTime,
  enabled: z.boolean(),
  model: id.nullable(),
  permissionMode: z.enum(["default", "acceptEdits", "auto", "bypassPermissions"]),
  accountId: id.nullable(),
})
const run = z.object({
  id,
  taskId: id,
  source: z.enum(["schedule", "manual"]),
  status: z.enum(["running", "succeeded", "failed", "stopped", "skipped"]),
  scheduledAt: optionalTime,
  triggeredAt: timestamp,
  finishedAt: optionalTime,
  reason: z.string().nullable(),
  sessionId: id.nullable(),
  accountId: id.nullable(),
  deniedApprovals: z.number().int().nonnegative(),
})
const savedTask = z
  .object({
    task: taskInput.extend({
      id,
      nextRunAt: optionalTime,
      lastRunAt: optionalTime,
      lastSessionId: id.nullable(),
      runCount: z.number().int().nonnegative(),
    }),
    eligibleFrom: timestamp,
    handledThrough: optionalTime,
    handledLocallyThrough: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
      .refine((value) => Number.isFinite(Date.parse(value)))
      .nullable(),
    active: run.nullable(),
    history: z.array(run).max(maximumScheduledTaskRuns),
  })
  .refine(({ task, active, history }) => {
    if (active !== null && (active.taskId !== task.id || active.status !== "running")) return false
    if (history.length + (active === null ? 0 : 1) > maximumScheduledTaskRuns) return false
    return history.every((record) => record.taskId === task.id && record.status !== "running")
  })
const scheduleFile = z
  .object({
    version: z.literal(1),
    timeZone: z.string().nullable(),
    tasks: z.array(savedTask),
  })
  .refine(({ tasks }) => new Set(tasks.map(({ task }) => task.id)).size === tasks.length)

/** 任务、当前配置开始生效的时刻、已处理游标、进行中的认领及运行历史。 */
export type SavedScheduledTask = z.infer<typeof savedTask>

/** 持久化的完整快照。调度服务串行读写这一份文件。 */
export type ScheduledTasksFile = z.infer<typeof scheduleFile>

/** 只接收 PigClaude 原生任务配置，执行前先校验重复间隔。 */
export function parseScheduledTaskInput(input: unknown): ScheduledTaskInput {
  const valid = taskInput.safeParse(input)
  if (valid.success) return valid.data
  if (valid.error.issues.some(({ message }) => message === "SCHEDULE_INTERVAL_TOO_SHORT"))
    throw new Error("SCHEDULE_INTERVAL_TOO_SHORT")
  throw new Error("SCHEDULE_TASK_INVALID")
}

/** 没有旧文件时读到空快照，损坏的文件会报告失败。 */
export async function readScheduledTasks(filePath: string): Promise<ScheduledTasksFile> {
  let text: string
  try {
    text = await readFile(filePath, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { version: 1, timeZone: null, tasks: [] }
    throw error
  }
  try {
    return scheduleFile.parse(JSON.parse(text))
  } catch {
    throw new Error("SCHEDULE_FILE_INVALID")
  }
}

/** 同一目录内先写新文件再替换，权限只允许本机用户读取提示词。 */
export async function writeScheduledTasks(
  filePath: string,
  file: ScheduledTasksFile,
): Promise<void> {
  const temporary = `${filePath}.${randomUUID()}.tmp`
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
  try {
    await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
      encoding: "utf8",
    })
    await rename(temporary, filePath)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}
