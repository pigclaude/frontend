// 负责 PigClaude 自己的英文词典：键必须与简体中文完全一致，缺键或多出的键都在编译期报错。
import type { zhCN } from "./messages.zh-CN"
import { permissionEnUS } from "./permission.messages"
import { shellEnUS } from "./shell.messages"
import { appearanceEnUS } from "./appearance.messages"

/** 英文主词典。 */
export const enUS = {
  ...shellEnUS,
  ...permissionEnUS,
  ...appearanceEnUS,
} satisfies Record<keyof typeof zhCN, string>
