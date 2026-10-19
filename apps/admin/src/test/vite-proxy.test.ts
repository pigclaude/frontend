// @vitest-environment node
// 负责真实 Vite HTTP 代理的原 Host、原查询与上游故障日志秘密边界。
import { createServer as createHttpServer, request } from "node:http"
import { fileURLToPath } from "node:url"
import { createServer as createViteServer, type UserConfig } from "vite"
import { expect, it, vi } from "vitest"
import config from "../../vite.config"
const root = fileURLToPath(new URL("../..", import.meta.url))
function get(port: number, path: string) {
  return new Promise<{ status: number; cookies: string[]; location?: string }>(
    (resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, path, headers: { Host: `127.0.0.1:${port}` } },
        (res) => {
          res.resume()
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              cookies: res.headers["set-cookie"] ?? [],
              location: res.headers.location,
            }),
          )
        },
      )
      req.on("error", reject)
      req.end()
    },
  )
}
it("preserves site authority and callback query while redacting actual stock Vite proxy failures", async () => {
  const received: { host?: string; url?: string }[] = []
  const fixture = createHttpServer((req, res) => {
    received.push({ host: req.headers.host, url: req.url })
    res
      .writeHead(303, {
        Location: "/users",
        "Set-Cookie": ["one=fixture; HttpOnly", "two=fixture; HttpOnly"],
      })
      .end()
  })
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve))
  const address = fixture.address()
  if (!address || typeof address === "string") throw new Error("fixture 未监听")
  const logs: string[] = []
  const error = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "))
  })
  const info = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "))
  })
  const actual = config as UserConfig
  const rule = actual.server?.proxy?.["/admin/v1"]
  if (!rule || typeof rule === "string") throw new Error("缺少实际代理配置")
  const server = await createViteServer({
    ...actual,
    configFile: false,
    root,
    server: {
      ...actual.server,
      host: "127.0.0.1",
      port: 0,
      proxy: { "/admin/v1": { ...rule, target: `http://127.0.0.1:${address.port}` } },
    },
  })
  try {
    await server.listen()
    const bound = server.httpServer?.address()
    if (!bound || typeof bound === "string") throw new Error("Vite 未监听")
    const callback =
      "/admin/v1/web/oidc/callback?code=TASK17_CODE_CANARY&state=TASK17_STATE_CANARY%2B%2520"
    const success = await get(bound.port, callback)
    expect(success).toEqual({
      status: 303,
      cookies: ["one=fixture; HttpOnly", "two=fixture; HttpOnly"],
      location: "/users",
    })
    const expectedHost = `127.0.0.1:${bound.port}`
    expect(received[0]?.url).toBe(callback)
    const hostPreserved = received[0]?.host === expectedHost
    await new Promise<void>((resolve, reject) =>
      fixture.close((error) => (error ? reject(error) : resolve())),
    )
    const failure = await get(bound.port, callback)
    expect(failure.status).toBe(500)
    expect(logs.join("\n")).not.toContain("TASK17_CODE_CANARY")
    expect(logs.join("\n")).not.toContain("TASK17_STATE_CANARY")
    expect(logs.join("\n")).toContain("proxy")
    expect(hostPreserved).toBe(true)
  } finally {
    await server.close()
    if (fixture.listening) await new Promise<void>((resolve) => fixture.close(() => resolve()))
    error.mockRestore()
    info.mockRestore()
  }
}, 30_000)
