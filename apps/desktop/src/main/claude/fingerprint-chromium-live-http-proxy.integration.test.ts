// 使用用户指定的 HTTP 上游代理验证真实浏览器与 Xray。

import { it } from "vitest"
import { verifyLiveProxy } from "./fingerprint-chromium-live-proxy-test-utils"

const enabled = process.env["PIGCLAUDE_TEST_LIVE_HTTP_PROXY"] === "1"

it.skipIf(!enabled)(
  "使用真实 HTTP 上游代理完成 HTTPS 出口核对、浏览器访问和失效阻断",
  async () => {
    const proxyUrl = process.env["PIGCLAUDE_TEST_HTTP_PROXY_URL"]?.trim()
    delete process.env["PIGCLAUDE_TEST_HTTP_PROXY_URL"]
    const browserBinary = process.env["PIGCLAUDE_TEST_CHROMIUM_BIN"]
    const xrayBinary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]
    if (!browserBinary || !xrayBinary || !proxyUrl) throw new Error("缺少真实代理测试所需资源")
    await verifyLiveProxy({ proxyUrl, browserBinary, xrayBinary, protocol: "http:" })
  },
  100_000,
)
