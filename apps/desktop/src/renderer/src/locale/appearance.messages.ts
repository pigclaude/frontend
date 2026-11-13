// 负责 PigClaude 的 Dock 外观设置文案。
/** 外观适配层的简体中文文案。 */
export const appearanceZhCN = {
  "appearance.additional": "其他外观设置",
  "appearance.split": "分别设置浅色和深色模式",
  "appearance.smoothing": "字体平滑",
  "appearance.reset": "重置为默认设置",
  "appearance.resetDescription": "外观设置会恢复默认值，已保存的自定义主题会保留。",
  "appearance.cancel": "取消",
  "appearance.confirm": "确认重置",
  "appearance.dock.title": "Dock 图标",
  "appearance.dock.description": "选择应用在 Dock 中使用的图标",
  "appearance.dock.classic": "经典",
  "appearance.dock.pink": "粉色",
  "appearance.dock.night": "夜色",
} as const

/** Dock 外观设置的英文文案。 */
export const appearanceEnUS = {
  "appearance.additional": "Additional appearance settings",
  "appearance.split": "Use separate light and dark themes",
  "appearance.smoothing": "Font smoothing",
  "appearance.reset": "Reset appearance",
  "appearance.resetDescription": "Restore the default appearance and keep your saved themes.",
  "appearance.cancel": "Cancel",
  "appearance.confirm": "Reset",
  "appearance.dock.title": "Dock icon",
  "appearance.dock.description": "Choose the app icon shown in the Dock",
  "appearance.dock.classic": "Classic",
  "appearance.dock.pink": "Pink",
  "appearance.dock.night": "Night",
} satisfies Record<keyof typeof appearanceZhCN, string>
