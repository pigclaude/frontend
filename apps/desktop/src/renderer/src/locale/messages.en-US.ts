// 负责 PigClaude 自己的英文词典：键必须与简体中文完全一致，缺键或多出的键都在编译期报错。
import type { zhCN } from "./messages.zh-CN"
import { permissionEnUS } from "./permission.messages"
import { shellEnUS } from "./shell.messages"
import { fingerprintExtraZhCN } from "./fingerprint-extra.messages"
import { fingerprintZhCN } from "./fingerprint.messages"
import { poolZhCN } from "./pool.messages"
import { flowsZhCN } from "./flows.messages"
import { settingsZhCN, startupSettingsEnUS } from "./settings.messages"
import { appSettingsZhCN } from "./app-settings.messages"
import { appearanceEnUS } from "./appearance.messages"
import { workbenchEnUS } from "./workbench.messages"

/** 英文主词典。 */
export const enUS = {
  ...shellEnUS,
  ...permissionEnUS,
  ...fingerprintExtraZhCN,
  ...fingerprintZhCN,
  ...poolZhCN,
  ...flowsZhCN,
  ...settingsZhCN,
  ...startupSettingsEnUS,
  ...appSettingsZhCN,
  ...appearanceEnUS,
  ...workbenchEnUS,
} satisfies Record<keyof typeof zhCN, string>
