// 校验能力插件的精确 DNS 域名，并提供安装确认与运行时共同采用的禁域判断。

import { isIP } from "node:net"
import { domainToASCII } from "node:url"

const prohibitedDomains = ["anthropic.com", "claude.ai", "claude.com", "claudeusercontent.com"]
const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** 规范化一个精确域名，支持 IDNA 和末尾根标签。 */
export function normalizePluginNetworkDomain(value: string): string | null {
  const raw = value.trim().replace(/\.$/, "")
  if (/\s/.test(raw) || [..."/\\:@?#%[]"].some((character) => raw.includes(character))) return null
  const domain = domainToASCII(raw).toLowerCase()
  if (
    domain.length > 253 ||
    isIP(domain) !== 0 ||
    !domain.split(".").every((label) => dnsLabel.test(label))
  )
    return null
  return domain
}

/** 永久拒绝 Claude 和 Anthropic 的域及其子域。 */
export function isProhibitedPluginDomain(value: string): boolean {
  const domain = normalizePluginNetworkDomain(value)
  return (
    domain !== null &&
    prohibitedDomains.some((root) => domain === root || domain.endsWith("." + root))
  )
}
