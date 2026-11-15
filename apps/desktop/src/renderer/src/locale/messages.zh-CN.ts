// 负责 PigClaude 自己的简体中文词典：按功能拆分的文案文件在这里合并；Pigcode 组件的文案在它自己的语言包里。
import { permissionZhCN } from "./permission.messages"
import { shellZhCN } from "./shell.messages"
import { fingerprintExtraZhCN } from "./fingerprint-extra.messages"
import { fingerprintZhCN } from "./fingerprint.messages"
import { poolZhCN } from "./pool.messages"
import { flowsZhCN } from "./flows.messages"
import { settingsZhCN } from "./settings.messages"
import { appSettingsZhCN } from "./app-settings.messages"
import { appearanceZhCN } from "./appearance.messages"
import { workbenchZhCN } from "./workbench.messages"
import { capabilityPluginSettingsZhCN } from "./capability-plugin-settings.messages"
import { scheduledTasksZhCN } from "./scheduled-tasks.messages"
import { capabilityPluginToolsZhCN } from "./capability-plugin-tools.messages"
import { pluginSettingsZhCN } from "./plugin-settings.messages"
import { pluginMarketplaceZhCN } from "./plugin-marketplace.messages"

/** 简体中文主词典；它的键就是 PigClaude 全部的文案键。 */
export const zhCN = {
  ...shellZhCN,
  ...permissionZhCN,
  ...fingerprintExtraZhCN,
  ...fingerprintZhCN,
  ...poolZhCN,
  ...flowsZhCN,
  ...settingsZhCN,
  ...appSettingsZhCN,
  ...appearanceZhCN,
  ...workbenchZhCN,
  ...scheduledTasksZhCN,
  ...capabilityPluginToolsZhCN,
  ...capabilityPluginSettingsZhCN,
  ...pluginSettingsZhCN,
  ...pluginMarketplaceZhCN,
}
