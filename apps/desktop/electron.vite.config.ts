// 负责用 electron-vite 分别构建主进程、预加载和渲染进程。
import react from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"
import type { Connect, Plugin } from "vite"
import { DevAuthorizationFixture } from "./src/dev/authorization-fixture"
import type {
  AuthorizationMode,
  AuthorizationPurpose,
  AuthorizationSession,
} from "./src/main/authorization/types"

const stripComments = { legalComments: "none" as const }

/** 开发时让系统浏览器里的授权页通知桌面端。正式环境由权限服务接管。 */
function devAuthorization(): Plugin {
  const fixture = new DevAuthorizationFixture()
  const handle: Connect.NextHandleFunction = (req, res, next) => {
    const path = req.url?.split("?")[0]
    if (path === "/authorize" && req.method === "GET") {
      const query = new URL(req.url ?? "/authorize", "http://localhost").searchParams
      const session = readFixtureSession(query)
      if (session) fixture.recordSession(session)
      if (session) return
    }
    if (path === "/authorize/approve" && req.method === "POST") {
      void readJson(req).then(
        (body) => {
          if (!isApprovalBody(body)) {
            respondJson(res, 400, { error: "授权参数无效" })
            return
          }
          try {
            respondJson(res, 200, fixture.approve(body))
          } catch (error: unknown) {
            respondJson(res, 400, { error: errorMessage(error) })
          }
        },
        () => respondJson(res, 400, { error: "授权请求无效" }),
      )
      return
    }
    if (path === "/authorize/token" && req.method === "POST") {
      void readJson(req).then(
        (body) => {
          if (!isTokenBody(body)) {
            respondJson(res, 400, { error: "token 参数无效" })
            return
          }
          try {
            respondJson(res, 200, fixture.exchange(body))
          } catch (error: unknown) {
            respondJson(res, 400, { error: errorMessage(error) })
          }
        },
        () => respondJson(res, 400, { error: "token 请求无效" }),
      )
      return
    }
    next()
  }
  return {
    name: "pigclaude-dev-authorization",
    configureServer(server) {
      server.middlewares.use(handle)
    },
  }
}

function readFixtureSession(query: URLSearchParams): AuthorizationSession | null {
  const sessionId = query.get("session_id")
  const state = query.get("state")
  const codeChallenge = query.get("code_challenge")
  const redirectUri = query.get("redirect_uri")
  const purpose = query.get("purpose")
  const mode = query.get("mode")
  if (
    !sessionId ||
    !state ||
    !codeChallenge ||
    !redirectUri ||
    !isPurpose(purpose) ||
    !isMode(mode)
  ) {
    return null
  }
  return {
    sessionId,
    state,
    codeVerifier: "fixture-verifier-not-used",
    codeChallenge,
    redirectUri,
    expiresAt: Date.now() + 10 * 60 * 1000,
    request: {
      purpose,
      mode,
      accountName: query.get("account_name") ?? undefined,
      proxyId: query.get("proxy_id") ?? undefined,
    },
    consumed: false,
  }
}

function isPurpose(value: string | null): value is AuthorizationPurpose {
  return value === "pigclaude-login" || value === "claude-account"
}

function isMode(value: string | null): value is AuthorizationMode {
  return value === "login" || value === "register" || value === "authorize"
}

function readJson(req: Parameters<Connect.NextHandleFunction>[0]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ""
    req.on("data", (chunk: Buffer | string) => {
      body += chunk.toString()
      if (body.length > 64 * 1024) reject(new Error("请求体过大"))
    })
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}") as unknown)
      } catch {
        reject(new Error("JSON 无效"))
      }
    })
    req.on("error", reject)
  })
}

function isApprovalBody(value: unknown): value is { sessionId: string; state: string } {
  return isRecord(value) && typeof value.sessionId === "string" && typeof value.state === "string"
}

function isTokenBody(
  value: unknown,
): value is { code: string; clientId: string; codeVerifier: string; redirectUri: string } {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.clientId === "string" &&
    typeof value.codeVerifier === "string" &&
    typeof value.redirectUri === "string"
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function respondJson(
  res: Parameters<Connect.NextHandleFunction>[1],
  status: number,
  body: unknown,
): void {
  res.statusCode = status
  res.setHeader("content-type", "application/json")
  res.end(JSON.stringify(body))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "授权请求失败"
}

export default defineConfig({
  main: {
    esbuild: stripComments,
    build: { minify: true, sourcemap: false },
  },
  preload: {
    esbuild: stripComments,
    build: { minify: true, sourcemap: false },
  },
  renderer: {
    esbuild: stripComments,
    plugins: [react(), devAuthorization()],
    build: { minify: true, sourcemap: false },
    server: { port: 5173, strictPort: true },
  },
})
