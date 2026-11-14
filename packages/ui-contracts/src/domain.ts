/** 定义 Pigcode 的持久领域实体与 Agent 功能描述。 */
import { z } from "zod"

/**
 * Agent 功能：一个 Agent 支持哪些功能。
 *
 * **只是界面提示**：界面据它隐藏做不到的控件，Host 不拿它拒绝任何 RPC。
 * 真正的能力由 driver 自己决定——可选的 `askQuestions`、原生会话 id 的有无，
 * 都比一个布尔值可靠；再加一层校验就是第二个真相来源，不一致时更难查。
 * 所以这里的值必须和 driver 的实际实现对得上（Codex 的 fork 就曾经写着 false 而实现是真的）。
 */
export const agentFeaturesSchema = z.object({
  streaming: z.boolean(),
  approvals: z.boolean(),
  questions: z.boolean(),
  plan: z.boolean(),
  resume: z.boolean(),
  fork: z.boolean(),
  rollback: z.boolean(),
  checkpoint: z.boolean(),
  subagents: z.boolean(),
  mcp: z.boolean(),
  images: z.boolean(),
  usage: z.boolean(),
  modelCatalog: z.boolean(),
  nativeSessionId: z.boolean(),
})

/** 线程的执行权限模式。 */
export const permissionModeSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/)

/**
 * 已知的推理强度（思考深度），按从低到高排列；界面给它们起了名字，排序也以它们为准。
 * Codex 的模型目录里有 none–ultra（none 是完全不思考），Claude 用 low–max。
 */
export const knownReasoningEfforts = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const

/**
 * 推理强度。不限定取值：agent 的模型目录里出现新档位时（Codex 的档位就是模型给出的任意字符串），
 * 原样列出、原样转发，界面显示它的原名，不用先改代码。模型目录里的 efforts 列出该模型实际可选的档位。
 */
export const reasoningEffortSchema = z.string().trim().min(1).max(64)

/**
 * Agent 在输入框 `/` 菜单里提供的一条命令：CLI 自己的命令，或用户、项目、插件装的 skill 与自定义命令。
 * 选中后把 text 插进输入框，作为消息的一部分发给 CLI，由 CLI 自己展开。
 */
export const agentCommandSchema = z.object({
  /** 不带前缀的名字，例如 compact、codex:review。 */
  name: z.string().min(1),
  /** 插进输入框的文字：Claude 是 `/名字`，Codex 的 skill 是 `$名字`。 */
  text: z.string().min(1),
  description: z.string().optional(),
  /** 参数提示，例如 `<file>`。 */
  argumentHint: z.string().optional(),
  /** builtin 是 CLI 自带的命令；skill 是 skill、插件命令与自定义命令。 */
  kind: z.enum(["builtin", "skill"]),
})

/** 项目实体，对应一个被 Pigcode 打开的本地根目录。 */
export const projectSchema = z.object({
  id: z.string().min(1),
  rootPath: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().datetime(),
})

/** 线程实体，保存会话级 Agent 与模型的最近选择。 */
export const threadSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  defaultAgentId: z.string().min(1),
  /** 创建时选定的 Agent 实例；旧数据没有这个字段时为 null，按 Agent id 当作默认实例。 */
  defaultInstanceId: z.string().min(1).nullable().default(null),
  lastAgentId: z.string().nullable(),
  /** 最近一次切换选定的实例；null 时沿用默认实例。 */
  lastInstanceId: z.string().min(1).nullable().default(null),
  lastModelId: z.string().nullable(),
  permissionMode: permissionModeSchema,
  /** 与权限独立，旧客户端没传时按关闭处理。 */
  planMode: z.boolean().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
  lastRunId: z.string().nullable(),
  /** 子代理会话所属的主会话；主会话为 null。子代理共用主会话的项目与工作目录，不出现在侧栏。 */
  parentThreadId: z.string().nullable().optional(),
})

/** GitHub PR 状态；gh CLI 只返回这三种大写状态。 */
export const pullRequestStateSchema = z.enum(["OPEN", "CLOSED", "MERGED"])

/** GitHub PR 摘要，供工作台 PR 面板展示。 */
export const pullRequestInfoSchema = z.object({
  number: z.number().int().positive(),
  url: z.string().min(1),
  state: pullRequestStateSchema,
  title: z.string(),
  headRefName: z.string().min(1),
  baseRefName: z.string().min(1),
})

/** 自定义重复「每 N 个单位」里 N 的上限。 */
export const MAX_SCHEDULE_EVERY = 200

/** 一天里的时刻「HH:MM」，24 小时制，按 Host 所在机器的本地时间。 */
export const clockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

const minuteSchema = z.number().int().min(0).max(59)

/** 星期几，0–6 表示周日到周六，与 Date.getDay() 一致。 */
const weekdaySchema = z.number().int().min(0).max(6)

const weekdaysSchema = z.array(weekdaySchema).min(1).max(7)

/** 几号，1–31；那个月没有这一天时落在月末。 */
const monthDaySchema = z.number().int().min(1).max(31)

const everySchema = z.number().int().min(1).max(MAX_SCHEDULE_EVERY)

/** 自定义重复从哪一刻起算：每 N 天、每 N 周这类规则按它对齐周期。 */
const anchorSchema = z.string().datetime()

/**
 * 定时任务什么时候运行，都按 Host 所在机器的本地时间：
 * - 常用：每小时第几分、每天、每个工作日（周一到周五）、每周的某几天、每月几号；
 * - 自定义重复：每 N 分钟 / 小时 / 天 / 周 / 个月 / 年，按 anchor 对齐周期。每 N 个月可以按日期
 *   （每月的这几号），也可以按星期（每月的第一个周几）；每 N 年是某月某日。
 */
export const scheduleRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hourly"), minute: minuteSchema }),
  z.object({ kind: z.literal("daily"), time: clockTimeSchema }),
  z.object({ kind: z.literal("weekdays"), time: clockTimeSchema }),
  z.object({ kind: z.literal("weekly"), days: weekdaysSchema, time: clockTimeSchema }),
  z.object({ kind: z.literal("monthly"), day: monthDaySchema, time: clockTimeSchema }),
  z.object({ kind: z.literal("everyMinutes"), every: everySchema, anchor: anchorSchema }),
  z.object({
    kind: z.literal("everyHours"),
    every: everySchema,
    minute: minuteSchema,
    anchor: anchorSchema,
  }),
  z.object({
    kind: z.literal("everyDays"),
    every: everySchema,
    time: clockTimeSchema,
    anchor: anchorSchema,
  }),
  z.object({
    kind: z.literal("everyWeeks"),
    every: everySchema,
    days: weekdaysSchema,
    time: clockTimeSchema,
    anchor: anchorSchema,
  }),
  z.object({
    kind: z.literal("everyMonths"),
    every: everySchema,
    days: z.array(monthDaySchema).min(1).max(31),
    time: clockTimeSchema,
    anchor: anchorSchema,
  }),
  z.object({
    kind: z.literal("everyMonthsWeekday"),
    every: everySchema,
    weekday: weekdaySchema,
    time: clockTimeSchema,
    anchor: anchorSchema,
  }),
  z.object({
    kind: z.literal("everyYears"),
    every: everySchema,
    month: z.number().int().min(1).max(12),
    day: monthDaySchema,
    time: clockTimeSchema,
    anchor: anchorSchema,
  }),
])

/** 定时任务的状态：运行中、已暂停，或者过了结束日期、不会再运行的已完成。 */
export const scheduleStatusSchema = z.enum(["active", "paused", "completed"])

/** 一次触发的结果：进行中、成功、失败、被停止，或者因为会话正忙、Agent 不可用而跳过。 */
export const scheduleRunStatusSchema = z.enum([
  "running",
  "succeeded",
  "failed",
  "stopped",
  "skipped",
])

/** Agent 功能的类型。 */
export type AgentFeatures = z.infer<typeof agentFeaturesSchema>

/** 权限模式的类型。 */
export type PermissionMode = z.infer<typeof permissionModeSchema>

/** 推理强度的类型。 */
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>

export type KnownReasoningEffort = (typeof knownReasoningEfforts)[number]

/** Agent 命令的类型。 */
export type AgentCommand = z.infer<typeof agentCommandSchema>

/** 项目的类型。 */
export type Project = z.infer<typeof projectSchema>

/** 线程的类型。 */
export type Thread = z.infer<typeof threadSchema>

/** GitHub PR 摘要的类型。 */
export type PullRequestInfo = z.infer<typeof pullRequestInfoSchema>

/** 定时任务运行规则的类型。 */
export type ScheduleRule = z.infer<typeof scheduleRuleSchema>

/** 定时任务状态的类型。 */
export type ScheduleStatus = z.infer<typeof scheduleStatusSchema>

/** 定时任务一次触发结果的类型。 */
export type ScheduleRunStatus = z.infer<typeof scheduleRunStatusSchema>
