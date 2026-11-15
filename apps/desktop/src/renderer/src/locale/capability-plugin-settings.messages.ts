// 负责声明式插件设置和命令状态的界面文案。
/** 插件贡献的简体中文文案。 */
export const capabilityPluginSettingsZhCN = {
  "capabilityPlugins.settings": "插件设置",
  "capabilityPlugins.loading": "正在读取插件设置…",
  "capabilityPlugins.optionEmpty": "请选择",
  "capabilityPlugins.secretConfigured": "密钥已保存",
  "capabilityPlugins.secretNotConfigured": "尚未设置密钥",
  "capabilityPlugins.clearSecret": "清除",
  "capabilityPlugins.clearSecretField": "清除{field}",
  "capabilityPlugins.save": "保存设置",
  "capabilityPlugins.saved": "设置已保存",
  "capabilityPlugins.settingsFailed": "无法读取或保存插件设置，请重试。",
  "capabilityPlugins.secretStorageUnavailable": "系统安全存储不可用，无法保存密钥。",
  "capabilityPlugins.commandFailed": "插件命令未完成。",
} as const

/** 与简体中文同键的英文文案。 */
export const capabilityPluginSettingsEnUS = {
  "capabilityPlugins.settings": "Plugin settings",
  "capabilityPlugins.loading": "Loading plugin settings…",
  "capabilityPlugins.optionEmpty": "Choose an option",
  "capabilityPlugins.secretConfigured": "Secret saved",
  "capabilityPlugins.secretNotConfigured": "Secret not set",
  "capabilityPlugins.clearSecret": "Clear",
  "capabilityPlugins.clearSecretField": "Clear {field}",
  "capabilityPlugins.save": "Save settings",
  "capabilityPlugins.saved": "Settings saved",
  "capabilityPlugins.settingsFailed": "Couldn't load or save plugin settings. Try again.",
  "capabilityPlugins.secretStorageUnavailable": "Secure system storage is unavailable.",
  "capabilityPlugins.commandFailed": "The plugin command didn't complete.",
} satisfies Record<keyof typeof capabilityPluginSettingsZhCN, string>
