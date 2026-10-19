// 负责将账号标识转换为 home 页面可展示的脱敏值。

/** 保留邮箱首字符、域名和地址结构，避免页面泄漏完整邮箱。 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@")
  if (at <= 0) return "••••"
  const local = email.slice(0, at)
  const domain = email.slice(at)
  return `${local.slice(0, 1)}•••${domain}`
}

/** 只保留用户 ID 的首尾片段，避免页面泄漏完整账号标识。 */
export function maskUserId(userId: string): string {
  if (userId.length <= 8) return "••••"
  return `${userId.slice(0, 4)}••••${userId.slice(-4)}`
}
