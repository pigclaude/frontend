// 固定本机自检使用的原始采样目标，不依赖第三方风险评分或允许页面提交 URL。

import type { EnvironmentCheckTargets } from "./environment-check-model"

/** 本机桥和上游请求共用的 IPv4 原始出口服务。 */
export const defaultEnvironmentExitUrl = "https://ipv4.icanhazip.com/"

/** 产品默认采样服务；两项出口都直接测量浏览器调用方的 IPv4。 */
export const environmentCheckTargets: EnvironmentCheckTargets = {
  primaryIp: defaultEnvironmentExitUrl,
  secondaryIp: "https://api-ipv4.ip.sb/geoip",
  claudeLogin: "https://claude.ai/login",
  stun: "stun:stun.cloudflare.com:3478",
  dnsQuery: "https://1.1.1.1/dns-query?name=example.com&type=A",
}
