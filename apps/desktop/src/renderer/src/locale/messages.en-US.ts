// 负责 PigClaude 自己的英文词典：键必须与简体中文完全一致，缺键或多出的键都在编译期报错。
import type { zhCN } from "./messages.zh-CN"
import { shellEnUS } from "./shell.messages"

/** 英文主词典。 */
export const enUS = {
  ...shellEnUS,
} satisfies Record<keyof typeof zhCN, string>
