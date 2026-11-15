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
import { scheduledTasksEnUS } from "./scheduled-tasks.messages"

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
  "appSettings.keepAwake": "Keep this computer awake",
  "appSettings.keepAwakeDetail":
    "Prevent idle sleep while the app is open so scheduled tasks run on time. Closing the lid follows your system settings.",
  "appSettings.keepAwakeFailed": "Couldn't load or save the keep-awake setting. Try again.",
  ...appearanceEnUS,
  ...workbenchEnUS,
  ...scheduledTasksEnUS,
} satisfies Record<keyof typeof zhCN, string>
