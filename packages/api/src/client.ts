// 负责提供带 cookie、错误解析和可注入 fetch 的共享 HTTP client。
export interface ApiErrorBody {
  code: number
  reason: string
  message: string
  metadata: Record<string, string>
}

/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export class ApiError extends Error {
  readonly status: number
  readonly reason: string
  readonly metadata: Record<string, string>
  constructor(status: number, body?: Partial<ApiErrorBody>) {
    super(body?.message || `请求失败（${status}）`)
    this.name = "ApiError"
    this.status = status
    this.reason = body?.reason || `HTTP_${status}`
    this.metadata = body?.metadata ?? {}
  }
}

// boolean 支持：proto bool 查询参数（如 admin ListRelations.currentOnly）序列化为 'true'/'false' 字符串。
export type Query = Record<string, string | number | boolean | undefined>

/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export interface HttpClient {
  get<T>(path: string, query?: Query): Promise<T>
  post<T>(path: string, body?: unknown): Promise<T>
  /** 以手动重定向模式读取成功 303 的 JSON 和 Location。 */
  postWithResponse<T>(path: string, body?: unknown): Promise<HttpResponse<T>>
  /** multipart/form-data；浏览器自动生成 boundary，调用方不得手写 Content-Type。 */
  postForm<T>(path: string, body: FormData): Promise<T>
  put<T>(path: string, body?: unknown): Promise<T>
  /** DELETE 无请求体（path 参数承载资源标识，如 /v1/sms/favorites/{serviceCode}）。 */
  delete<T>(path: string): Promise<T>
}

/** HTTP client 返回的状态和 Location 元数据，供需要处理 303 的 endpoint 使用。 */
export interface HttpResponse<T> {
  data: T
  status: number
  location: string | null
}

function qs(query?: Query): string {
  if (!query) return ""
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === "") continue
    p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ""
}

/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export interface ClientOptions {
  baseUrl?: string
  credentials?: RequestCredentials
  onUnauthorized?: () => void | Promise<void>
  fetch?: typeof globalThis.fetch
  /**
   * 可选的附加请求头工厂：每次请求时求值（而非创建 client 时冻结），便于注入
   * 随环境变化的头（如 home 端按 cookie locale 注入 Accept-Language）。
   * 不传时行为与旧版完全一致（admin 零影响）；返回的头会与内部头合并，
   * 内部头（Content-Type）优先，不可被覆盖。
   */
  headers?: () => Record<string, string>
}

/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export function createClient(opts: ClientOptions = {}): HttpClient {
  const base = opts.baseUrl ?? ""
  const requestFetch = opts.fetch ?? globalThis.fetch

  async function requestResponse<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Query,
    redirect: RequestRedirect = "follow",
  ): Promise<HttpResponse<T>> {
    const headers: Record<string, string> = { ...opts.headers?.() }
    const isForm = typeof FormData !== "undefined" && body instanceof FormData
    if (body !== undefined && !isForm) headers["Content-Type"] = "application/json"
    const init: RequestInit = { method, credentials: opts.credentials ?? "include", redirect }
    if (Object.keys(headers).length > 0) init.headers = headers
    if (isForm) init.body = body
    else if (body !== undefined) init.body = JSON.stringify(body)
    const res = await requestFetch(base + path + qs(query), init)
    const location = res.headers.get("location")
    if (res.ok || (res.status === 303 && location !== null)) {
      try {
        return { data: (await res.json()) as T, status: res.status, location }
      } catch {
        if (res.status === 303) {
          throw new ApiError(303, { message: "授权回调响应无效" })
        }
        throw new Error("响应 JSON 无效")
      }
    }
    let parsed: Partial<ApiErrorBody> | undefined
    try {
      parsed = (await res.json()) as Partial<ApiErrorBody>
    } catch {
      /* 纯文本错误（OAuth 等） */
    }
    if (res.status === 401) await opts.onUnauthorized?.()
    throw new ApiError(res.status, parsed)
  }

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Query,
  ): Promise<T> {
    return (await requestResponse<T>(method, path, body, query)).data
  }

  return {
    get: (path, query) => request("GET", path, undefined, query),
    post: (path, body) => request("POST", path, body ?? {}),
    postWithResponse: (path, body) =>
      requestResponse("POST", path, body ?? {}, undefined, "manual"),
    postForm: (path, body) => request("POST", path, body),
    put: (path, body) => request("PUT", path, body ?? {}),
    delete: (path) => request("DELETE", path),
  }
}
