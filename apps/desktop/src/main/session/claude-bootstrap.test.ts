// 负责验证经 daemon 读取组织模型：请求照随包 Claude Code 的 bootstrap，响应整理成 CLI 的模型缓存项，
// 任何失败都返回 null。用本机 HTTP 服务充当 daemon，不访问网络。

import { readFile } from "node:fs/promises"
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { claudeCodeVersion, readOrganizationModels } from "./claude-bootstrap"

type SeenRequest = {
  method: string | undefined
  url: string | undefined
  headers: IncomingHttpHeaders
}

const servers: Server[] = []
const sessionToken = "catalog-session-token"

afterEach(closeAll)

async function closeAll(): Promise<void> {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
}

describe("readOrganizationModels", () => {
  it("asks the daemon with the CLI's bootstrap request and keeps the enabled options", async () => {
    const seen: SeenRequest[] = []
    const baseUrl = await fakeDaemon((request, response) => {
      seen.push({ method: request.method, url: request.url, headers: request.headers })
      json(response, 200, {
        client_data: { ignored: true },
        additional_model_options: [
          { model: "claude-org-alpha", name: "Org Alpha", description: "Alpha model" },
          {
            model: "claude-org-beta",
            name: "Org Beta",
            description: "Beta model",
            disabled_reason: "Blocked by your organization",
          },
          { model: "claude-org-gamma", name: "Org Gamma", description: "", disabled_reason: null },
        ],
      })
    })

    const models = await readOrganizationModels({ baseUrl, sessionToken })

    expect(models).toEqual([
      { value: "claude-org-alpha", label: "Org Alpha", description: "Alpha model" },
      { value: "claude-org-gamma", label: "Org Gamma", description: "" },
    ])
    expect(seen).toHaveLength(1)
    expect(seen[0]?.method).toBe("GET")
    expect(seen[0]?.url).toBe("/api/claude_cli/bootstrap?entrypoint=sdk-ts&model=claude-sonnet-5-5")
    expect(seen[0]?.headers).toMatchObject({
      "x-pigclaude-session": sessionToken,
      "user-agent": "claude-code/2.1.310",
      "anthropic-beta": "oauth-2025-04-20",
      "content-type": "application/json",
    })
    expect(seen[0]?.headers.authorization).toBeUndefined()
  })

  it.each([
    { label: "an empty answer", body: {} },
    { label: "a null option list", body: { additional_model_options: null } },
  ])("treats $label as no organization models", async ({ body }) => {
    const baseUrl = await fakeDaemon((_request, response) => json(response, 200, body))

    await expect(readOrganizationModels({ baseUrl, sessionToken })).resolves.toEqual([])
  })

  it.each([
    { label: "no available account", status: 503, body: '{"error":"no_available_account"}' },
    { label: "an unusable proxy", status: 503, body: '{"error":"proxy_unavailable"}' },
    { label: "a rejected credential", status: 401, body: '{"type":"error"}' },
    { label: "a body that is not JSON", status: 200, body: "<html>" },
    {
      label: "an option with the wrong shape",
      status: 200,
      body: JSON.stringify({
        additional_model_options: [{ model: 7, name: "x", description: "" }],
      }),
    },
  ])("returns null for $label", async ({ status, body }) => {
    const baseUrl = await fakeDaemon((_request, response) => {
      response.writeHead(status, { "content-type": "application/json" })
      response.end(body)
    })

    await expect(readOrganizationModels({ baseUrl, sessionToken })).resolves.toBeNull()
  })

  it("returns null when the daemon is not listening", async () => {
    const baseUrl = await fakeDaemon(() => undefined)
    await closeAll()

    await expect(readOrganizationModels({ baseUrl, sessionToken })).resolves.toBeNull()
  })

  it("gives up when the daemon does not answer in time", async () => {
    const baseUrl = await fakeDaemon(() => undefined)

    await expect(readOrganizationModels({ baseUrl, sessionToken }, 50)).resolves.toBeNull()
  })
})

describe("claudeCodeVersion", () => {
  it("matches the bundled Claude Code, so an SDK upgrade asks for the bootstrap contract to be rechecked", async () => {
    const entry = createRequire(import.meta.url).resolve("@anthropic-ai/claude-agent-sdk")
    const manifest: unknown = JSON.parse(
      await readFile(join(dirname(entry), "package.json"), "utf8"),
    )

    expect(manifest).toMatchObject({ claudeCodeVersion })
  })
})

async function fakeDaemon(
  handle: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer((request, response) => {
    request.resume()
    request.on("end", () => handle(request, response))
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("假 daemon 没有监听")
  return `http://127.0.0.1:${address.port}`
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify(body))
}
