// 负责按授权网络模式发送 OAuth HTTP 请求，并统一响应体的读取与释放。

import type {
  XrayHttpRequest,
  XrayHttpRequestInit,
  XrayHttpResponse,
} from "@pigclaude/login-gate/xray-http"
import { fetch as undiciFetch, type Dispatcher } from "undici"

/** OAuth 请求允许指定上游代理或 Xray 入口，不能同时指定。 */
export type OAuthRequestNetwork = {
  dispatcher?: Dispatcher
  xrayRequest?: XrayHttpRequest
  signal?: AbortSignal
}

/** 将授权取消信号与单次请求超时合并。 */
export function oauthRequestSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout])
}

/** 按明确指定的网络发送一次请求，不自动切换请求路径。 */
export async function requestOAuth(
  fetch: typeof undiciFetch,
  url: string,
  input: XrayHttpRequestInit,
  network: OAuthRequestNetwork,
): Promise<XrayHttpResponse> {
  if (network.xrayRequest !== undefined) {
    if (network.dispatcher !== undefined) throw new Error("OAuth 网络配置冲突")
    return network.xrayRequest(url, input)
  }
  const response = await fetch(url, {
    ...input,
    ...(network.dispatcher === undefined ? {} : { dispatcher: network.dispatcher }),
    redirect: "manual",
  })
  return {
    ok: response.ok,
    text: () => response.text(),
    discard: async () => {
      await response.body?.cancel().catch(() => undefined)
    },
  }
}
