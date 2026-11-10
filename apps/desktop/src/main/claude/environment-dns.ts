// 校验浏览器实际 DoH JSON 响应，查询固定公开域名，不把配置参数或无响应当成已测 DNS。

import type { EnvironmentCheckItem, NativeEnvironmentResponse } from "./environment-check-model"
import { environmentCheckItem } from "./environment-policy"
import { publicEnvironmentIpv4 } from "./environment-address"
import { record } from "./environment-browser-client"
import { localBridgePort } from "./launch-argument-guard"

/** 只接受当前固定目标、无缓存/SW、传输正常且匹配固定 A 问题的公网 DNS 答案。 */
export function environmentDnsCheck(
  response: NativeEnvironmentResponse | undefined,
  url: string | undefined,
  mode: "system" | "bound",
  bridgeUrl: string | null,
): EnvironmentCheckItem {
  let answers = 0
  let valid = false
  const port = localBridgePort(bridgeUrl)
  const routed =
    mode === "system" ||
    (port !== null && response?.peerAddress === "127.0.0.1" && response.peerPort === port)
  if (
    response &&
    url &&
    response.url === url &&
    response.status === 200 &&
    !response.error &&
    !response.fromCache &&
    !response.fromServiceWorker &&
    (!url.startsWith("https:") || response.secure) &&
    routed
  ) {
    try {
      const data: unknown = JSON.parse(response.body)
      if (
        record(data) &&
        data.Status === 0 &&
        Array.isArray(data.Question) &&
        data.Question.length === 1 &&
        record(data.Question[0]) &&
        data.Question[0].type === 1 &&
        typeof data.Question[0].name === "string" &&
        data.Question[0].name.replace(/\.$/, "").toLowerCase() === "example.com" &&
        Array.isArray(data.Answer)
      ) {
        answers = data.Answer.filter(
          (answer: unknown) =>
            record(answer) && answer.type === 1 && publicEnvironmentIpv4(answer.data) !== null,
        ).length
        valid = answers > 0
      }
    } catch {
      /* 非 DNS JSON 没有可用证据。 */
    }
  }
  return environmentCheckItem(
    "proxy-dns",
    mode,
    mode === "system" ? "info" : valid ? "passed" : "unknown",
    {
      expected: "浏览器通过本次代理实际完成固定 example.com A 的 HTTPS DNS 查询",
      actual: `HTTP ${response?.status || "未收到"}；有效公网 A 答案 ${answers}${mode === "system" ? "；本轮为系统网络" : ""}`,
      evidence: `native 响应体、匹配的问题与公网答案；${routed ? "连接路径已核对" : "连接路径未确认"}；固定 IPv4 DoH 服务；不是操作系统 DNS 泄漏实验`,
      remedy:
        valid || mode === "system"
          ? "无需处理；仅覆盖所测 DoH 请求"
          : "核对当前代理对固定 DoH 服务的可达性和实际响应后重新检测",
    },
  )
}
