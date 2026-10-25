// 负责将邮箱转换为 home 页面可展示的脱敏值。

/** 保留邮箱首字符、域名和地址结构，避免页面泄漏完整邮箱。 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@")
  if (at <= 0) return "••••"
  const local = email.slice(0, at)
  const domain = email.slice(at)
  return `${local.slice(0, 1)}•••${domain}`
}
