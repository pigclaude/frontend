// 负责识别会覆盖受管浏览器目录或代理设置的原始启动参数。

const managedKeys = new Set([
  "user-data-dir",
  "profile-directory",
  "proxy-server",
  "proxy-bypass-list",
  "no-proxy-server",
  "proxy-pac-url",
  "proxy-auto-detect",
  "pigclaude-managed-network",
])

const boundProxyKeys = new Set(["host-resolver-rules", "host-rules", "use-system-proxy-resolver"])

// 与 Chromium 148 的 POSIX ASCII 空白和 Windows 宽字符空白保持一致。
const asciiBoundaryWhitespace = /^[\u0009-\u000d\u0020]+|[\u0009-\u000d\u0020]+$/g
const windowsBoundaryWhitespace =
  /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g

/** 返回首个受管参数的脱敏错误；不修改输入数组。 */
export function launchArgumentConflict(
  args: readonly string[],
  proxyBound: boolean,
  hostPlatform: NodeJS.Platform = process.platform,
): string | null {
  for (const arg of args) {
    const key = switchKey(arg, hostPlatform)
    if (key === null) continue
    if (managedKeys.has(key) || (proxyBound && boundProxyKeys.has(key)))
      return `原始参数 --${key} 与账号目录或网络设置冲突，请在高级设置中移除`
  }
  return null
}

/** 返回有效的本机代理桥端口，拒绝凭据或额外路径。 */
export function localBridgePort(value: unknown): number | null {
  if (typeof value !== "string") return null
  const match = /^http:\/\/127\.0\.0\.1:(\d{1,5})\/?$/.exec(value)
  if (match === null) return null
  const port = Number(match[1])
  return port >= 1 && port <= 65535 ? port : null
}

/** 校验代理桥是本机 HTTP 端点，且不包含凭据或额外路径。 */
export function isValidBridgeUrl(value: unknown): value is string {
  return localBridgePort(value) !== null
}

/** 只接受本次授权服务器的精确 localhost 回调，并返回有效端口。 */
export function managedCallbackPort(value: unknown): number | null {
  if (typeof value !== "string") return null
  const match = /^http:\/\/localhost:([1-9]\d{0,4})\/callback$/.exec(value)
  if (match === null) return null
  const port = Number(match[1])
  return port <= 65535 ? port : null
}

function switchKey(arg: string, hostPlatform: NodeJS.Platform): string | null {
  const windows = hostPlatform === "win32"
  const value = arg.replace(windows ? windowsBoundaryWhitespace : asciiBoundaryWhitespace, "")
  const prefix = value.startsWith("--")
    ? 2
    : value.startsWith("-") || (windows && value.startsWith("/"))
      ? 1
      : 0
  if (prefix === 0 || prefix === value.length) return null
  const separator = value.indexOf("=")
  const key = value.slice(prefix, separator === -1 ? undefined : separator)
  return windows
    ? key.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32))
    : key
}
