// 验证真实 Xray 拒绝不受信任的 HTTPS 上游代理证书。

import { readFile } from "node:fs/promises"
import { createServer as createHttpServer } from "node:http"
import { createServer as createHttpsServer } from "node:https"
import { join, resolve } from "node:path"
import { createXrayHttpClient } from "@pigclaude/login-gate/xray-http"
import { expect, it } from "vitest"
import { createXrayRuntimeStarter } from "./xray-runtime"

const binary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]
const fixtures = resolve(
  import.meta.dirname,
  "../../../../../packages/login-gate/src/test-fixtures",
)

it.skipIf(!binary)(
  "HTTPS 上游代理证书不受信任时拒绝连接，目标未收到请求",
  async () => {
    const key = await readFile(join(fixtures, "loopback-ip-synthetic-key.pem"))
    const cert = await readFile(join(fixtures, "loopback-ip-synthetic-cert.pem"))
    const proxy = createHttpsServer({ key, cert })
    let rejected = 0
    proxy.on("tlsClientError", () => {
      rejected += 1
    })
    let requests = 0
    const target = createHttpServer((_request, response) => {
      requests += 1
      response.end("unexpected")
    })
    const start = createXrayRuntimeStarter({
      binaryPath: binary,
      hostArch: process.arch,
      idleTimeoutMs: 0,
    })
    try {
      const proxyPort = await listen(proxy)
      const targetPort = await listen(target)
      const runtime = await start({ upstreamProxyUrl: `https://127.0.0.1:${proxyPort}` })
      const client = createXrayHttpClient(runtime.url)
      try {
        await expect(
          client.request(`http://127.0.0.1:${targetPort}/`, {
            method: "GET",
            headers: {},
            signal: AbortSignal.timeout(5_000),
          }),
        ).rejects.toThrow()
        expect(rejected).toBeGreaterThan(0)
        expect(requests).toBe(0)
      } finally {
        client.close()
        await runtime.close()
      }
    } finally {
      const results = await Promise.allSettled([
        start.dispose(),
        proxy.listening ? new Promise<void>((done) => proxy.close(() => done())) : undefined,
        target.listening ? new Promise<void>((done) => target.close(() => done())) : undefined,
      ])
      if (results.some((result) => result.status === "rejected")) throw new Error("测试资源未回收")
    }
  },
  15_000,
)

async function listen(server: ReturnType<typeof createHttpServer>): Promise<number> {
  await new Promise<void>((ready, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", ready)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("合成服务未启动")
  return address.port
}
