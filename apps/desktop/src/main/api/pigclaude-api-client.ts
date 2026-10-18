// 负责把 Electron 主进程的授权和会员检查请求发送到 loopback Rust API。
import type { MembershipView } from "@pigclaude/contracts/membership"
import type {
  DesktopAuthorizationExchangeRequest,
  DesktopAuthorizationExchangeResponse,
  DesktopAuthorizationStartRequest,
  DesktopAuthorizationStartResponse,
  DesktopDeviceRevokeRequest,
  DesktopMembershipErrorCode,
  MembershipInspectRequest,
} from "@pigclaude/contracts/desktop-membership"

/** API client 可替换的网络依赖，保证测试不需要启动 Electron 或 Rust。 */
export type PigclaudeApiClientOptions = {
  baseUrl: string
  /** 浏览器授权页的 origin；Rust start 只返回相对 home 路径。 */
  authorizationOrigin?: string
  fetcher?: typeof fetch
  accessToken?: () => Promise<string | null>
  /** 返回完整 Cookie header 或单独的 pigclaude_session 值。 */
  sessionCookie?: () => Promise<string | null>
  inspectPath?: string
}

/** Desktop composition 所需的 Rust API 端口，便于测试替换 HTTP 实现。 */
export type PigclaudeApi = Pick<
  PigclaudeApiClient,
  "startAuthorization" | "exchangeAuthorization" | "inspectMembership" | "revokeDevice"
>

/** Rust API 返回的固定错误，保证 gate 不依赖 HTTP 文案。 */
export class PigclaudeApiError extends Error {
  readonly code: DesktopMembershipErrorCode | string
  readonly status: number | null

  /** 创建带有 Rust code 和 HTTP 状态的 API 错误。 */
  constructor(code: DesktopMembershipErrorCode | string, status: number | null, message = code) {
    super(message)
    this.name = "PigclaudeApiError"
    this.code = code
    this.status = status
  }
}

/** 访问 Rust desktop/membership route 的主进程 client。 */
export class PigclaudeApiClient {
  readonly #baseUrl: URL
  readonly #authorizationBaseUrl: URL
  readonly #fetcher: typeof fetch
  readonly #accessToken: NonNullable<PigclaudeApiClientOptions["accessToken"]> | null
  readonly #sessionCookie: NonNullable<PigclaudeApiClientOptions["sessionCookie"]> | null
  readonly #inspectPath: string

  /** 创建绑定到 Rust base URL 的 API client。 */
  constructor(options: PigclaudeApiClientOptions) {
    this.#baseUrl = normalizeBaseUrl(options.baseUrl)
    this.#authorizationBaseUrl = normalizeBaseUrl(options.authorizationOrigin ?? options.baseUrl)
    this.#fetcher = options.fetcher ?? fetch
    this.#accessToken = options.accessToken ?? null
    this.#sessionCookie = options.sessionCookie ?? null
    this.#inspectPath = options.inspectPath ?? "/v1/desktop/membership/inspect"
  }

  /** 创建浏览器授权 flow，返回已解析的 Rust authorization URL。 */
  async startAuthorization(
    input: DesktopAuthorizationStartRequest,
  ): Promise<DesktopAuthorizationStartResponse> {
    const response = await this.request<DesktopAuthorizationStartResponse>(
      "/v1/desktop/authorizations/start",
      { method: "POST", body: input },
    )
    if (!isRecord(response) || typeof response.flowId !== "string") {
      throw new PigclaudeApiError("INVALID_RESPONSE", 200, "授权启动响应格式无效")
    }
    if (
      typeof response.authorizationUrl !== "string" ||
      (typeof response.expiresAt !== "string" && typeof response.expiresAt !== "number")
    ) {
      throw new PigclaudeApiError("INVALID_RESPONSE", 200, "授权启动响应缺少字段")
    }
    return {
      flowId: response.flowId,
      authorizationUrl: resolveUrl(response.authorizationUrl, this.#authorizationBaseUrl),
      expiresAt: response.expiresAt,
      clientId: readNullableString(response.clientId),
      redirectUri: readNullableString(response.redirectUri),
      callbackUrl: readNullableString(response.callbackUrl),
      purpose: readNullableString(response.purpose),
    }
  }

  /** 交换一次性 code，结果只包含设备和用户脱敏标识。 */
  async exchangeAuthorization(
    input: DesktopAuthorizationExchangeRequest,
  ): Promise<DesktopAuthorizationExchangeResponse> {
    const response = await this.request<DesktopAuthorizationExchangeResponse>(
      "/v1/desktop/authorizations/exchange",
      { method: "POST", body: input },
    )
    if (
      !isRecord(response) ||
      typeof response.deviceId !== "string" ||
      typeof response.bindingEpoch !== "string" ||
      typeof response.userId !== "string"
    ) {
      throw new PigclaudeApiError("INVALID_RESPONSE", 200, "授权交换响应格式无效")
    }
    return {
      deviceId: response.deviceId,
      bindingEpoch: response.bindingEpoch,
      userId: response.userId,
      sessionCookie: readNullableString(response.sessionCookie) ?? undefined,
    }
  }

  /** 从 Rust 重新读取会员状态；本地缓存不参与有效性判定。 */
  async inspectMembership(input: MembershipInspectRequest): Promise<MembershipView> {
    const query = new URLSearchParams({ deviceId: input.deviceId })
    if (input.bindingEpoch !== null) query.set("bindingEpoch", input.bindingEpoch)
    const separator = this.#inspectPath.includes("?") ? "&" : "?"
    const response = await this.request<unknown>(
      `${this.#inspectPath}${separator}${query.toString()}`,
      {
        method: "GET",
      },
    )
    return normalizeMembership(response, input)
  }

  /** 请求 Rust 撤销设备；成功后由 gate 清理本机材料。 */
  async revokeDevice(input: DesktopDeviceRevokeRequest): Promise<void> {
    await this.request<unknown>("/v1/desktop/devices/revoke", { method: "POST", body: input })
  }

  private async request<T>(
    path: string,
    options: { method: "GET" | "POST"; body?: unknown },
  ): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" }
    if (options.body !== undefined) headers["content-type"] = "application/json"
    const accessToken = await this.#accessToken?.()
    if (accessToken) headers.authorization = `Bearer ${accessToken}`
    const sessionCookie = await this.#sessionCookie?.()
    if (sessionCookie) headers.cookie = formatSessionCookie(sessionCookie)
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new PigclaudeApiError("SERVER_UNAVAILABLE", null))
      }, 10_000)
    })
    try {
      return await Promise.race([
        deadline,
        (async () => {
          const response = await this.#fetcher(resolveUrl(path, this.#baseUrl), {
            method: options.method,
            headers,
            signal: controller.signal,
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
          })
          const body = await readJson(response)
          if (!response.ok) throw new PigclaudeApiError(readErrorCode(body), response.status)
          if (response.status === 204 || body === undefined) return undefined as T
          return body as T
        })(),
      ])
    } catch (error: unknown) {
      if (error instanceof PigclaudeApiError) throw error
      throw new PigclaudeApiError("SERVER_UNAVAILABLE", null, "Rust 授权服务不可用")
    } finally {
      clearTimeout(timer)
    }
  }
}

function normalizeBaseUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Rust API base URL 必须使用 HTTP")
  }
  return new URL(url.toString().replace(/\/$/, ""))
}

function resolveUrl(path: string, baseUrl: URL): string {
  return new URL(path, `${baseUrl.toString().replace(/\/$/, "")}/`).toString()
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function readErrorCode(value: unknown): string {
  if (!isRecord(value)) return "HTTP_ERROR"
  if (typeof value.code === "string" && value.code.length > 0) return value.code
  if (typeof value.error === "string" && value.error.length > 0) return value.error
  return "HTTP_ERROR"
}

function normalizeMembership(value: unknown, input: MembershipInspectRequest): MembershipView {
  if (!isRecord(value)) throw new PigclaudeApiError("INVALID_RESPONSE", 200, "会员响应格式无效")
  const status = readString(value.status)
  const state = readMembershipState(value.state, status)
  const account = isRecord(value.account)
    ? {
        userId: readString(value.account.userId),
        nickname: readString(value.account.nickname),
        email: readString(value.account.email),
        avatar: readString(value.account.avatar),
      }
    : null
  return {
    startupPhase: value.startupPhase === "checking" ? "checking" : "settled",
    revision: typeof value.revision === "number" ? value.revision : 0,
    state,
    account,
    productCode:
      value.productCode === "pigclaude" || value.productCode === undefined ? "pigclaude" : null,
    planKind: readPlanKind(value.planKind),
    lifetime: value.lifetime === true,
    membershipValidUntil: readNullableString(value.membershipValidUntil ?? value.validUntil),
    offlineValidUntil: readNullableString(value.offlineValidUntil),
    lastVerifiedAt: readNullableString(value.lastVerifiedAt),
    nextVerificationAt: readNullableString(value.nextVerificationAt),
    bindingEpoch: readNullableString(value.bindingEpoch) ?? input.bindingEpoch,
    errorCode: readNullableString(value.errorCode),
    serverReason: readNullableString(value.serverReason),
    authorizationUrl: readNullableString(value.authorizationUrl),
  }
}

function readMembershipState(value: unknown, status: string): MembershipView["state"] {
  if (
    value === "configuration_error" ||
    value === "signed_out" ||
    value === "connecting" ||
    value === "active" ||
    value === "offline_grace" ||
    value === "expired" ||
    value === "verification_required" ||
    value === "device_revoked" ||
    value === "error"
  ) {
    return value
  }
  if (status === "active") return "active"
  if (status === "expired") return "expired"
  if (status === "device_revoked") return "device_revoked"
  return "verification_required"
}

function readPlanKind(value: unknown): MembershipView["planKind"] {
  return value === "day" || value === "week" || value === "lifetime" ? value : null
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function formatSessionCookie(value: string): string {
  return value.startsWith("pigclaude_session=") ? value : `pigclaude_session=${value}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
