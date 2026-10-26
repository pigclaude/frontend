// 负责定义会话输入区的权限、思考深度和键盘选项；模型与账号列表由会话桥和账号桥提供。

import type { SessionPermissionMode } from "../../../main/session/session-types"

/** 输入区权限模式，与 SessionHost 的四档一致。 */
export type PermissionMode = SessionPermissionMode

/** 输入区思考深度，与 session.start 的 thinking 参数一致。 */
export type ThinkingDepth = "off" | "low" | "medium" | "high"

/** 纯键盘事件结果。 */
export type ComposerKeyAction = "submit" | "newline" | "ignore"

/** 输入区支持的权限模式及说明。 */
export const permissionModes: ReadonlyArray<readonly [PermissionMode, string, string]> = [
  ["default", "每次询问", "改文件、运行命令前都先问"],
  ["acceptEdits", "自动改文件", "文件编辑自动通过，运行命令仍然询问"],
  ["plan", "只做计划", "只读，不改任何文件"],
  ["bypassPermissions", "跳过确认", "所有工具直接执行，仅限临时排障"],
]

/** 输入区支持的思考深度。 */
export const thinkingDepths: ReadonlyArray<readonly [ThinkingDepth, string]> = [
  ["off", "关闭"],
  ["low", "低"],
  ["medium", "中"],
  ["high", "高"],
]

/** 将键盘事件转换为提交、换行或忽略动作。 */
export function getComposerKeyAction(key: string, shiftKey: boolean): ComposerKeyAction {
  if (key !== "Enter") return "ignore"
  return shiftKey ? "newline" : "submit"
}
