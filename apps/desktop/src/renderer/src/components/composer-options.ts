// 负责定义会话输入区的权限、模型、思考深度和键盘选项。

/** 输入区权限模式。 */
export type PermissionMode = "ask" | "edit" | "plan"

/** 输入区思考深度。 */
export type ThinkingDepth = "off" | "low" | "medium" | "high" | "max"

/** 纯键盘事件结果。 */
export type ComposerKeyAction = "submit" | "newline" | "ignore"

/** 输入区支持的权限模式及说明。 */
export const permissionModes: ReadonlyArray<readonly [PermissionMode, string, string]> = [
  ["ask", "每次询问", "改文件、运行命令前都先问"],
  ["edit", "自动改文件", "运行命令仍然询问"],
  ["plan", "只做计划", "只读，不改任何文件"],
]

/** 输入区支持的模型。 */
export const composerModels = ["Opus 5.5", "Sonnet 5.5", "Haiku 5.5"] as const

/** 输入区支持的思考深度。 */
export const thinkingDepths: ReadonlyArray<readonly [ThinkingDepth, string]> = [
  ["off", "关闭"],
  ["low", "低"],
  ["medium", "中"],
  ["high", "高"],
  ["max", "最大"],
]

/** 将键盘事件转换为提交、换行或忽略动作。 */
export function getComposerKeyAction(key: string, shiftKey: boolean): ComposerKeyAction {
  if (key !== "Enter") return "ignore"
  return shiftKey ? "newline" : "submit"
}
