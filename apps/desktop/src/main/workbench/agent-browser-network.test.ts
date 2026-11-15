// 验证 Agent 浏览器的地址白名单和分区网络阻断；测试使用合成地址，不发起网络请求。

import type { CallbackResponse, HeadersReceivedResponse, Session } from "electron"
import { describe, expect, it, vi } from "vitest"
import {
  configureAgentBrowserRuntime,
  installAgentBrowserNetwork,
  isAgentBrowserAddress,
  isAgentBrowserResource,
} from "./agent-browser-network"

describe("Agent 浏览器本机范围", () => {
  it.each([
    "http://localhost:9123",
    "https://127.0.0.1",
    "http://127.2.3.4:8080/nested",
    "http://[::1]:3000",
  ])("接受 %s", (url) => expect(isAgentBrowserAddress(url)).toBe(true))

  it.each([
    "http://0.0.0.0/",
    "http://192.168.1.4/",
    "http://[::ffff:127.0.0.1]/",
    "http://name:password@localhost/",
    "http://localhost.example.test/",
    "file:///synthetic",
    "data:text/plain,synthetic",
    "about:srcdoc",
  ])("拒绝作为导航地址 %s", (url) => expect(isAgentBrowserAddress(url)).toBe(false))

  it("仅对分区资源放行 data、blob 和 srcdoc", () => {
    expect(isAgentBrowserResource("data:text/plain,local")).toBe(true)
    expect(isAgentBrowserResource("blob:http://localhost/example")).toBe(true)
    expect(isAgentBrowserResource("about:srcdoc")).toBe(true)
    expect(isAgentBrowserResource("https://example.test/image")).toBe(false)
    expect(isAgentBrowserResource("ws://localhost:4000")).toBe(false)
  })

  it("缺少必需的 Chromium 策略时拒绝创建 Agent 分区", () => {
    const appendSwitch = vi.fn()
    configureAgentBrowserRuntime({
      getSwitchValue: (key) => (key === "disable-features" ? "ConnectionAllowlists" : ""),
      appendSwitch,
    })
    expect(appendSwitch).not.toHaveBeenCalled()
    expect(() => installAgentBrowserNetwork({} as Session)).toThrow(
      "WORKBENCH_BROWSER_POLICY_UNAVAILABLE",
    )
  })

  it("限制 Agent 分区的资源、WebRTC、Service Worker 和下载，保留原有响应策略", async () => {
    const appendSwitch = vi.fn()
    configureAgentBrowserRuntime({
      getSwitchValue: (key) =>
        key === "enable-features" ? "ExistingFeature,ConnectionAllowlists<Trial" : "",
      appendSwitch,
    })
    expect(appendSwitch).toHaveBeenCalledExactlyOnceWith(
      "enable-features",
      "ExistingFeature,ConnectionAllowlists<Trial,OverrideConnectionAllowlistOriginTrial",
    )
    let request:
      ((details: { url: string }, reply: (result: CallbackResponse) => void) => void) | undefined
    let sendHeaders:
      | ((
          details: { requestHeaders: Record<string, string> },
          reply: (result: CallbackResponse) => void,
        ) => void)
      | undefined
    let receivedHeaders:
      | ((
          details: { resourceType: string; responseHeaders?: Record<string, string[]> },
          reply: (result: HeadersReceivedResponse) => void,
        ) => void)
      | undefined
    let download: ((event: { preventDefault(): void }) => void) | undefined
    const setProxy = vi.fn(async () => undefined)
    const session = {
      setProxy,
      webRequest: {
        onBeforeRequest: (listener: typeof request) => {
          request = listener
        },
        onBeforeSendHeaders: (listener: typeof sendHeaders) => {
          sendHeaders = listener
        },
        onHeadersReceived: (listener: typeof receivedHeaders) => {
          receivedHeaders = listener
        },
      },
      on: (event: string, listener: typeof download) => {
        if (event === "will-download") download = listener
      },
    } as unknown as Session
    const network = installAgentBrowserNetwork(session)
    await network.ready
    expect(installAgentBrowserNetwork(session)).toBe(network)
    expect(setProxy).toHaveBeenCalledExactlyOnceWith({ mode: "direct" })
    const respond = vi.fn()
    request?.({ url: "http://127.0.0.1:4555/local.css" }, respond)
    request?.({ url: "http://192.168.1.4:4555/external.css" }, respond)
    sendHeaders?.({ requestHeaders: { "Content-Type": "application/javascript" } }, respond)
    sendHeaders?.({ requestHeaders: { "Service-Worker": "script" } }, respond)
    const respondHeaders = vi.fn()
    receivedHeaders?.(
      {
        resourceType: "subFrame",
        responseHeaders: {
          "connection-allowlist": [
            '("http://localhost:*/*?query=a,b");webrtc=allow, (response-origin)',
          ],
          "content-type": ["text/html"],
        },
      },
      respondHeaders,
    )
    expect(respondHeaders).toHaveBeenCalledExactlyOnceWith({
      responseHeaders: {
        "Connection-Allowlist": [
          '("http://localhost:*/*?query=a,b");webrtc=allow;webrtc=block, (response-origin)',
        ],
        "content-type": ["text/html"],
      },
    })
    const preventDefault = vi.fn()
    download?.({ preventDefault })
    expect(respond.mock.calls).toEqual([
      [{ cancel: false }],
      [{ cancel: true }],
      [{ cancel: false }],
      [{ cancel: true }],
    ])
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(network.blockedRequests).toBe(3)
  })
})
