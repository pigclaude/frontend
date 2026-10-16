// 组装这次会话的环境变量，并把时区写进 Intl 预加载脚本。不读文件，不访问网络。

const ignoredSettingsKeys = new Set([
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
])

type SessionEnvInput = {
  daemonBaseUrl: string
  timezone: string
  locale: string
  userSettingsEnv: Record<string, string>
}

/** 返回新的会话环境。保证地址、时区和语言来自这次会话，并丢掉用户设置里的路由和凭据键。 */
export function buildSessionEnv(input: SessionEnvInput): {
  env: Record<string, string>
  preloadSource: string
} {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(input.userSettingsEnv)) {
    if (ignoredSettingsKeys.has(key)) continue
    env[key] = value
  }
  env.ANTHROPIC_BASE_URL = input.daemonBaseUrl
  env.TZ = input.timezone
  env.LANG = input.locale
  return { env, preloadSource: timezonePreload(input.timezone) }
}

function timezonePreload(timezone: string): string {
  return `const timezone = ${JSON.stringify(timezone)}
const Original = Intl.DateTimeFormat
Intl.DateTimeFormat = function (...args) {
  const options = { ...(args[1] ?? {}), timeZone: timezone }
  return new Original(args[0], options)
}
Intl.DateTimeFormat.prototype = Original.prototype
`
}
