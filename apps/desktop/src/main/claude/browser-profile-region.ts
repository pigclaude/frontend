// 经所选代理查询两个固定原始服务，只有同一 IPv4 的地区资料才用于初始化实例。

import { fetch as fetchUpstream } from "undici"
import { createProxyAgent } from "@pigclaude/proxy-connection"
import type { BrowserProfileRegion } from "@pigclaude/contracts/browser-profile"
import { environmentResponseIp, publicEnvironmentIpv4 } from "./environment-address"
import { defaultEnvironmentExitUrl } from "./environment-targets"

/** 使用原始 IP 与同一调用方 GeoIP，不关闭 TLS、不跟随重定向、不回退直连。 */
export async function browserProfileRegion(proxyUrl: string): Promise<BrowserProfileRegion> {
  if (process.env["NODE_TLS_REJECT_UNAUTHORIZED"] === "0")
    throw new Error("地区初始化要求 TLS 校验")
  const dispatcher = createProxyAgent(proxyUrl)
  const signal = AbortSignal.timeout(12_000)
  try {
    const results = await Promise.allSettled([
      read(defaultEnvironmentExitUrl),
      read("https://api-ipv4.ip.sb/geoip"),
    ])
    const [plain, geo] = results
    if (!plain || !geo || plain.status !== "fulfilled" || geo.status !== "fulfilled")
      throw new Error("未能取得完整代理地区资料，请手动设置语言和时区")
    const ip = environmentResponseIp(plain.value)
    const value: unknown = JSON.parse(geo.value)
    if (
      !record(value) ||
      !ip ||
      publicEnvironmentIpv4(value.ip) !== ip ||
      typeof value.country_code !== "string" ||
      !/^[A-Z]{2}$/.test(value.country_code) ||
      typeof value.timezone !== "string"
    )
      throw new Error("代理出口与地区资料不一致或缺少时区")
    const timezone = new Intl.DateTimeFormat("en", { timeZone: value.timezone }).resolvedOptions()
      .timeZone
    const regionLocale = new Intl.Locale(`und-${value.country_code}`).maximize()
    if (regionLocale.language === "und") throw new Error("该地区没有可用的默认语言，请手动设置")
    const locale = new Intl.Locale(`${regionLocale.language}-${value.country_code}`).baseName
    return { ip, countryCode: value.country_code, timezone, locale }
  } finally {
    await dispatcher.close()
  }

  async function read(url: string): Promise<string> {
    const response = await fetchUpstream(url, {
      dispatcher,
      signal,
      redirect: "error",
      headers: { "user-agent": "PigClaude-profile-region/1" },
    })
    if (response.status !== 200) {
      await response.body?.cancel()
      throw new Error("地区服务未成功响应")
    }
    const chunks: Uint8Array[] = []
    let length = 0
    if (!response.body) throw new Error("地区服务缺少正文")
    for await (const chunk of response.body) {
      length += chunk.length
      if (length > 65_536) throw new Error("地区服务正文超过上限")
      chunks.push(chunk)
    }
    return Buffer.concat(chunks).toString("utf8")
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
