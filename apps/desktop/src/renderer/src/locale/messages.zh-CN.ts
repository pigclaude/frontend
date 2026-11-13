// 负责 PigClaude 自己的简体中文词典：按功能拆分的文案文件在这里合并；Pigcode 组件的文案在它自己的语言包里。
import { permissionZhCN } from "./permission.messages"
import { shellZhCN } from "./shell.messages"

/** 简体中文主词典；它的键就是 PigClaude 全部的文案键。 */
export const zhCN = {
  ...shellZhCN,
  ...permissionZhCN,
}
