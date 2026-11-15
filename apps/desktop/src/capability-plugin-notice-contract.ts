// 能力插件通知只跨进程传递宿主清单的显示名和单行短文本。

/** 主进程向当前主窗口发送应用内提示的固定频道。 */
export const capabilityPluginNoticeChannel = "pigclaude:capability-plugin-notice"

/** 主窗口可显示的能力插件通知。 */
export type CapabilityPluginNotice = {
  readonly pluginName: string
  readonly message: string
}

/** 只订阅插件提示，回调不接触 Electron 事件。 */
export type CapabilityPluginNoticesBridge = {
  subscribe(listener: (notice: CapabilityPluginNotice) => void): () => void
}

/** 只提取显示字段，拒绝过长或空文本并清除方向控制符。 */
export function readCapabilityPluginNotice(value: unknown): CapabilityPluginNotice | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("pluginName" in value) ||
    !("message" in value)
  )
    return null
  const pluginName = singleLine(value.pluginName, 120)
  const message = singleLine(value.message, 240)
  return pluginName && message ? { pluginName, message } : null
}

function singleLine(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" || value.length > maxLength) return null
  return (
    value
      .replace(/\p{Bidi_Control}/gu, "")
      .replace(/[\p{Cc}\s]+/gu, " ")
      .trim() || null
  )
}
