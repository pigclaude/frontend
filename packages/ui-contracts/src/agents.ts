/**
 * Agent（由 Agent 插件接入）的设置字段、检测状态与设置页摘要；Host、插件与界面共用。
 * 设置字段由插件在 manifest 的 `contributes.agent.settings` 里声明，界面据此生成表单，
 * Host 原样保存用户填的值，并在检测、读取模型目录和创建会话时交给 driver。
 */
import { z } from "zod"

/** 可本地化的文案：一段文字，或按 locale（`zh-CN`、`en-US`、`en`…）给出的多段文字。 */
export const localizedTextSchema = z.union([
  z.string().min(1),
  z.record(z.string().min(1), z.string().min(1)),
])

/** 统一权限菜单选项的展示形状；实际选项由平台定义。 */
export const agentPermissionModeSchema = z.object({
  id: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/)
    .refine((id) => id !== "plan", "plan is reserved for legacy planning"),
  label: localizedTextSchema,
  description: localizedTextSchema,
  kind: z.enum(["ask", "edit", "auto", "read-only", "full-access", "deny"]),
  requiresConfirmation: z.boolean().optional(),
  /** 兼容已有会话的原生模式；未选中时不出现在常用菜单。 */
  hidden: z.boolean().optional(),
  command: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .optional(),
})

/** 声明已接入统一四档权限协议，以及是否支持独立计划模式。 */
export const agentExecutionModesSchema = z.object({ plan: z.boolean() })

export type AgentPermissionMode = z.infer<typeof agentPermissionModeSchema>

export type AgentExecutionModes = z.infer<typeof agentExecutionModesSchema>

export type LocalizedText = z.infer<typeof localizedTextSchema>

/** 插件报告的 CLI 更新信息；更新任务由 Host 统一排队。 */
export interface AgentCliUpdateState {
  instanceId: string
  agentId: string
  target: string
  phase:
    "checking" | "checked" | "queued" | "waiting" | "running" | "succeeded" | "unchanged" | "failed"
  currentVersion: string | null
  latestVersion: string | null
  available: boolean
  canUpdate: boolean
  command: string | null
  reason: "unsupported" | "not-installed" | "unknown-installation" | "manager-unavailable" | null
  error: string | null
  output: string
}

/**
 * 按 locale 取文案：完整 locale → 语言前缀 → 英文 → 第一条。
 * 插件可以只写一段文字，也可以给每种语言各写一段。
 */
export function localizeText(text: LocalizedText, locale: string): string {
  if (typeof text === "string") return text
  const language = locale.split("-")[0] ?? locale
  return text[locale] ?? text[language] ?? text["en-US"] ?? text.en ?? Object.values(text)[0] ?? ""
}
