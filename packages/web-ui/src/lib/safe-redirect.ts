// 负责校验本域绝对回跳路径，合法 query 和 state 保持原始字节。
/** 拒绝 URL 解析会改变来源的路径、反斜杠和控制字符。 */
export function safeRedirectPath(value: string | null, fallback: string): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    return fallback
  try {
    const base = "https://redirect.invalid"
    return new URL(value, base).origin === base ? value : fallback
  } catch {
    return fallback
  }
}
