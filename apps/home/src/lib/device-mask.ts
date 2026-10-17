// 负责将设备标识转换为页面可展示的脱敏值。

/** 将设备标识转换成固定的首尾脱敏格式。 */
export function maskDeviceValue(value: string): string {
  if (value.length <= 8) return "••••"
  return `${value.slice(0, 4)}••••${value.slice(-4)}`
}
