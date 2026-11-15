// 插件工具询问方式的设置文案。

export const capabilityPluginToolsZhCN = {
  "capabilityPluginTools.title": "插件工具询问",
  "capabilityPluginTools.label": "{plugin}的工具询问",
  "capabilityPluginTools.description": "下次启动会话时生效",
  "capabilityPluginTools.alwaysAsk": "每次询问",
  "capabilityPluginTools.followSession": "跟随会话权限档",
  "capabilityPluginTools.saveFailed": "未能保存插件工具询问设置",
}

export const capabilityPluginToolsEnUS = {
  "capabilityPluginTools.title": "Plugin tool approvals",
  "capabilityPluginTools.label": "Tool approvals for {plugin}",
  "capabilityPluginTools.description": "Applies the next time a session starts",
  "capabilityPluginTools.alwaysAsk": "Ask every time",
  "capabilityPluginTools.followSession": "Follow session permissions",
  "capabilityPluginTools.saveFailed": "Could not save plugin tool approvals",
} satisfies Record<keyof typeof capabilityPluginToolsZhCN, string>
