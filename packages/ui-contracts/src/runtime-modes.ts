import { z } from "zod"

/** T3 Code 同等的四档运行权限；计划状态独立保存。 */
export const runtimeModeSchema = z.enum([
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
])

export type RuntimeMode = z.infer<typeof runtimeModeSchema>

export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access"
