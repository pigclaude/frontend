// 验证 daemon 通过账号代理发起 CONNECT 时保留单字段 Basic 认证。

import { describe, expect, it } from "vitest"
import { LocalDaemon } from "./daemon.ts"
import { startRecordingProxy } from "./daemon-proxy-fixture.test.ts"

const sessionToken = "local-proxy-auth-test"

describe("daemon 代理认证", () => {
  it.each([
    { username: "name", password: "", decoded: "name:" },
    { username: "", password: "secret", decoded: ":secret" },
  ])("账号代理只配置一个认证字段时仍使用它", async ({ username, password, decoded }) => {
    const seen: Array<{ path: string; authorization: string | undefined }> = []
    const proxyAuth: Array<string | undefined> = []
    const proxy = await startRecordingProxy(seen, {
      onProxyAuthorization: (value) => proxyAuth.push(value),
    })
    try {
      const upstream = new URL(proxy.url)
      upstream.username = username
      upstream.password = password
      const daemon = new LocalDaemon({
        port: 0,
        sessionToken,
        choose: () => ({
          id: "test-account",
          authorization: "access-token",
          proxyUrl: upstream.href,
        }),
        runAuthorized: async (operation) => operation(new AbortController().signal),
      })
      try {
        await daemon.start()
        const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/messages`, {
          method: "POST",
          headers: { "x-pigclaude-session": sessionToken },
          body: "{}",
        })
        expect(response.status).toBe(200)
        expect(await response.text()).toBe("ok")
        expect(proxyAuth).toEqual([`Basic ${Buffer.from(decoded).toString("base64")}`])
        expect(seen[0]?.authorization).toBe("Bearer access-token")
      } finally {
        await daemon.stop()
      }
    } finally {
      await proxy.stop()
    }
  })
})
