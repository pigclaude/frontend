// 负责通过真实 loopback HTTP 验证固定目标、Host、Cookie、手动重定向和日志。
// @vitest-environment node
import { createServer, type RequestListener, type Server } from "node:http"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createBackendProxy } from "@/lib/backend-proxy"
const servers: Server[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
})
async function backend(handler: RequestListener) {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("fixture address")
  return `http://127.0.0.1:${address.port}`
}
describe("Home fixed-target proxy", () => {
  it("accepts the existing fixed container backend origin", () => {
    expect(() => createBackendProxy("http://api:8788")).not.toThrow()
  })
  it.each([
    "/v1/web/oidc/callback",
    "/v1/user/me",
    "/v1/entitlement",
    "/v1/user/identities",
    "/v1/user/devices",
    "/oauth2/federation/github/callback",
  ])("preserves Host and cookies for %s without following callback", async (path) => {
    const requests: string[] = []
    const target = await backend((req, res) => {
      requests.push(req.url ?? "")
      expect(req.headers.host).toBe("www.pigclaude.test:3000")
      expect(req.headers.cookie).toBe("browser=synthetic")
      expect(req.headers["x-forwarded-host"]).toBeUndefined()
      res.writeHead(303, {
        Location: "/landing?code=synthetic-location&state=synthetic-state",
        "Set-Cookie": ["one=1; Path=/; HttpOnly", "two=2; Path=/; HttpOnly"],
      })
      res.end("callback")
    })
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined)
    const response = await createBackendProxy(target)(
      new Request(
        `http://www.pigclaude.test:3000${path}?code=synthetic-code&state=synthetic-state`,
        {
          headers: {
            host: "www.pigclaude.test:3000",
            cookie: "browser=synthetic",
            "x-forwarded-host": "attacker.invalid",
          },
        },
      ),
    )
    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toContain("synthetic-location")
    expect(response.headers.getSetCookie()).toHaveLength(2)
    expect(await response.text()).toBe("callback")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(requests).toHaveLength(1)
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      /synthetic-code|synthetic-state|synthetic-location/,
    )
    expect(JSON.stringify(log.mock.calls)).toContain(path)
  })
  it("passes mutation body and Origin to the single configured backend", async () => {
    const target = await backend((req, res) => {
      expect(req.headers.origin).toBe("http://home.test:3000")
      let body = ""
      req.on("data", (part: Buffer) => {
        body += part.toString()
      })
      req.on("end", () => {
        expect(JSON.parse(body)).toEqual({ csrf: "synthetic-csrf" })
        res.writeHead(204)
        res.end()
      })
    })
    const response = await createBackendProxy(target)(
      new Request("http://home.test:3000/v1/web/oidc/logout?target=https://attacker.invalid", {
        method: "POST",
        headers: {
          host: "home.test:3000",
          origin: "http://home.test:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ csrf: "synthetic-csrf" }),
      }),
    )
    expect(response.status).toBe(204)
  })
  it.each([
    "http://attacker.invalid",
    "http://api:8789",
    "http://api.evil:8788",
    "http://127.0.0.1:8788/path",
    "http://user:pass@127.0.0.1:8788",
    "http://127.0.0.1:8788?url=x",
  ])("rejects unsafe configured target %s", (target) => {
    expect(() => createBackendProxy(target)).toThrow()
  })
})
