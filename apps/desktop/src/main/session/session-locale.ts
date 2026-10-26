// 负责把账号指纹里的时区和语言归一成会话可用的值：空值与 system 时区回退到宿主系统，非空显式值保留。

/** 返回宿主系统的 IANA 时区；取不到时回退 UTC。 */
export function systemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

/** 返回宿主系统的 locale；取不到时回退 en-US。 */
export function systemLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "en-US"
  } catch {
    return "en-US"
  }
}

/** 归一化会话时区。保证空字符串和 system（忽略大小写与空白）回退到系统时区，显式 IANA 名称原样保留。 */
export function normalizeSessionTimezone(value: string | null | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : ""
  if (trimmed === "" || trimmed.toLowerCase() === "system") return systemTimezone()
  return trimmed
}

/** 归一化会话语言。保证空字符串回退到系统 locale，非空值去空白后保留。 */
export function normalizeSessionLocale(value: string | null | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : ""
  return trimmed === "" ? systemLocale() : trimmed
}
