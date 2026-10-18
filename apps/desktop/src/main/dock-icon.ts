// 负责校验渲染进程传来的 Dock 图标数据地址，只放行体积受限的 PNG data URL。
const pngPrefix = "data:image/png;base64,"
const maxLength = 2_000_000

/** 返回合法的 PNG data URL 原值；非字符串、非 PNG 或超过 2_000_000 字符时返回 null，从不抛出。 */
export function readDockIconDataUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  if (!value.startsWith(pngPrefix) || value.length > maxLength) return null
  return value
}
