// 规范化共享配置的语言和时区，用同一规则约束 CLI 启动、账号选择和浏览器自检。

/** 已确定的实例环境；可选来源标识用于运行时保留配置使用权。 */
export type ProfileEnvironment = {
  locale: string
  timezone: string
  browserProfileId?: string
  profileRevision?: number
  accountId?: string
}

/** 只接受明确、合法的语言和 IANA 时区，不能在比较时回退宿主值。 */
export function profileEnvironmentKey(
  environment: Pick<ProfileEnvironment, "locale" | "timezone">,
): string | null {
  if (!environment.locale || !environment.timezone || environment.timezone === "system") return null
  try {
    return JSON.stringify([
      new Intl.Locale(environment.locale).baseName,
      new Intl.DateTimeFormat("en", { timeZone: environment.timezone }).resolvedOptions().timeZone,
    ])
  } catch {
    return null
  }
}

/** 比较明确环境的规范化语言和时区；任何未知值都不能视为兼容。 */
export function sameProfileEnvironment(
  a: Pick<ProfileEnvironment, "locale" | "timezone">,
  b: Pick<ProfileEnvironment, "locale" | "timezone">,
): boolean {
  const key = profileEnvironmentKey(a)
  return key !== null && key === profileEnvironmentKey(b)
}
