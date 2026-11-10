// 组装这次会话的环境变量，并把时区写进 Intl 预加载脚本。不读文件，不访问网络。用户设置里的路由、代理、云厂商开关和凭据不会进入这次会话。

import { processLocale } from "./process-locale"

const ignoredSettingsKeys = new Set([
  "ALL_PROXY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "all_proxy",
  "http_proxy",
  "https_proxy",
])

type SessionEnvInput = {
  daemonBaseUrl: string
  timezone: string
  locale: string
  userSettingsEnv: Record<string, string>
}

/** 返回新的会话环境。保证地址、时区和语言来自这次会话，并丢掉用户设置里的路由、代理、云厂商开关和凭据键。 */
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
  env.LANG = processLocale(input.locale)
  env.LC_ALL = env.LANG
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
