// 负责第一方 OAuth 的逻辑归属、单飞轮换、持久消费屏障及本机写入序列。
import type { OAuthDesktopSession } from "@pigclaude/contracts/desktop-membership"
import type { PigclaudeApi } from "../api/pigclaude-api-client"
import { MAX_ACCESS_TOKEN_SECONDS } from "@pigclaude/contracts/oauth"
import { PigclaudeApiError } from "../api/oauth-client"
import type { SecretVault } from "../secret-vault"
import { parseOAuthDesktopSession } from "./oauth-session"

/** 管理器仅依赖当前协议 API 与 profile 安全仓库。 */
export type OAuthTokenManagerOptions = {
  vault: SecretVault
  api: Pick<PigclaudeApi, "refreshToken">
  now?: () => number
}
/** 请求捕获的逻辑授权与不可变材料，不跨 renderer 边界。 */
export type OAuthSnapshot = { owner: number; record: OAuthDesktopSession }

/** 所有第一方写入共用本机队列；队列永远不包含网络等待。 */
export class OAuthTokenManager {
  readonly #vault: SecretVault
  readonly #api: OAuthTokenManagerOptions["api"]
  readonly #now: () => number
  #owner = 0
  #suspended = false
  #loaded = false
  #record: OAuthDesktopSession | null = null
  #writes: Promise<void> = Promise.resolve()
  #loading: Promise<void> | null = null
  #refresh: { owner: number; promise: Promise<void> } | null = null

  /** 绑定唯一 profile 仓库，构造时不进行网络请求。 */
  constructor(options: OAuthTokenManagerOptions) {
    this.#vault = options.vault
    this.#api = options.api
    this.#now = options.now ?? Date.now
  }

  /** 当前逻辑会话代次，正常同族轮换不会改变它。 */
  get owner(): number {
    return this.#owner
  }

  /** 判定原逻辑归属仍可操作；暂停立即失效所有原请求。 */
  isCurrent(owner: number): boolean {
    return !this.#suspended && owner === this.#owner
  }

  /** 只读取当前格式，不从旧材料补身份或默认授权。 */
  async snapshot(): Promise<OAuthSnapshot | null> {
    const owner = this.#owner
    if (this.#suspended) throw failure("AUTHORIZATION_CANCELLED")
    await this.#writes
    this.assertCurrent(owner)
    if (!this.#loaded) {
      this.#loading ??= this.load(owner)
      const loading = this.#loading
      try {
        await loading
      } finally {
        if (this.#loading === loading) this.#loading = null
      }
    }
    this.assertCurrent(owner)
    return this.#record ? { owner, record: { ...this.#record } } : null
  }

  /** 新 code grant 同步更换归属，即使四个身份元数据完全相同。 */
  adopt(input: OAuthDesktopSession, isCurrent: () => boolean = () => true): Promise<void> {
    const record = parseOAuthDesktopSession(JSON.stringify(input))
    if (!record) return Promise.reject(failure("INVALID_OAUTH_SESSION"))
    if (this.#suspended || !isCurrent()) return Promise.reject(failure("AUTHORIZATION_CANCELLED"))
    const owner = ++this.#owner
    this.#record = null
    this.#loaded = false
    this.#loading = null
    return this.write(async () => {
      this.assertCurrent(owner)
      if (!isCurrent()) throw failure("AUTHORIZATION_CANCELLED")
      await this.store(record)
      this.assertCurrent(owner)
      if (!isCurrent()) {
        await this.#vault.delete("membership:session")
        throw failure("AUTHORIZATION_CANCELLED")
      }
      this.#record = record
      this.#loaded = true
    })
  }

  /** 返回当前访问 token；仅本地过期自动触发单飞轮换。 */
  async accessToken(): Promise<string> {
    return (await this.usable()).record.accessToken
  }

  /** 保持原 owner 执行业务；只有明确 invalid_token 可轮换并重试一次。 */
  async run<T>(operation: (snapshot: OAuthSnapshot) => Promise<T>): Promise<T> {
    const original = await this.usable()
    try {
      this.assertCurrent(original.owner)
      const result = await operation(original)
      this.assertCurrent(original.owner)
      return result
    } catch (error: unknown) {
      this.assertCurrent(original.owner)
      if (codeOf(error) !== "invalid_token") throw error
      await this.rotate(original)
      const refreshed = await this.snapshot()
      this.assertCurrent(original.owner)
      if (!refreshed) throw failure("AUTHORIZATION_REQUIRED")
      const result = await operation(refreshed)
      this.assertCurrent(original.owner)
      return result
    }
  }

  /** 同步失效代次，只返回已进入本机的写入屏障，不等待 refresh HTTP。 */
  suspend(): Promise<void> {
    this.#owner++
    this.#suspended = true
    this.#record = null
    this.#loaded = true
    this.#loading = null
    return this.#writes
  }

  /** 允许后续新授权，绝不重新读回暂停前的旧材料。 */
  resume(): void {
    this.#suspended = false
  }

  /** 清理当前第一方材料；expectedOwner 防止旧业务删除新授权。 */
  clear(expectedOwner?: number): Promise<boolean> {
    if (expectedOwner !== undefined && !this.isCurrent(expectedOwner)) return Promise.resolve(false)
    const accountId = this.#record?.userId
    this.#owner++
    this.#record = null
    this.#loaded = true
    this.#loading = null
    return this.write(async () => {
      try {
        if (this.#vault.deletePrefix)
          await this.#vault.deletePrefix("authorization:pigclaude-login:")
        else if (accountId) await this.#vault.delete(`authorization:pigclaude-login:${accountId}`)
        await this.#vault.delete("membership:session")
        return true
      } catch {
        throw failure("SAFE_STORAGE_UNAVAILABLE")
      }
    })
  }

  private async load(owner: number): Promise<void> {
    let raw: string | null
    try {
      raw = await this.#vault.get("membership:session")
    } catch {
      throw failure("SAFE_STORAGE_UNAVAILABLE")
    }
    this.assertCurrent(owner)
    this.#record = parseOAuthDesktopSession(raw)
    this.#loaded = true
  }

  private async usable(): Promise<OAuthSnapshot> {
    const snapshot = await this.snapshot()
    if (!snapshot) throw failure("AUTHORIZATION_REQUIRED")
    if (this.#refresh?.owner === snapshot.owner) await this.#refresh.promise
    this.assertCurrent(snapshot.owner)
    if (snapshot.record.refreshTokenExpiresAt <= this.#now()) {
      await this.write(async () => {
        this.assertCurrent(snapshot.owner)
        this.#record = null
        try {
          await this.#vault.delete("membership:session")
        } catch {
          throw failure("SAFE_STORAGE_UNAVAILABLE")
        }
      })
      throw failure("AUTHORIZATION_REQUIRED")
    }
    if (snapshot.record.accessTokenExpiresAt <= this.#now()) await this.rotate(snapshot)
    this.assertCurrent(snapshot.owner)
    if (!this.#record) throw failure("AUTHORIZATION_REQUIRED")
    return { owner: snapshot.owner, record: { ...this.#record } }
  }

  private rotate(snapshot: OAuthSnapshot): Promise<void> {
    this.assertCurrent(snapshot.owner)
    if (this.#refresh?.owner === snapshot.owner) return this.#refresh.promise
    if (this.#record?.refreshToken !== snapshot.record.refreshToken) return Promise.resolve()
    const promise = this.refresh(snapshot)
    this.#refresh = { owner: snapshot.owner, promise }
    const finish = () => {
      if (this.#refresh?.promise === promise) this.#refresh = null
    }
    void promise.then(finish, finish)
    return promise
  }

  private async refresh({ owner, record }: OAuthSnapshot): Promise<void> {
    // 先持久删除旧 refresh 的恢复入口；崩溃重启只能重新授权，不能重发旧材料。
    await this.write(async () => {
      this.assertCurrent(owner)
      try {
        await this.#vault.delete("membership:session")
      } catch {
        throw failure("SAFE_STORAGE_UNAVAILABLE")
      }
    })
    this.assertCurrent(owner)
    const issuedAt = this.#now()
    try {
      const token = await this.#api.refreshToken(record.refreshToken)
      this.assertCurrent(owner)
      const next = parseOAuthDesktopSession(
        JSON.stringify({
          ...record,
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          scope: token.scope,
          accessTokenExpiresAt: issuedAt + token.expires_in * 1_000,
        }),
      )
      if (
        !next ||
        token.refresh_token === record.refreshToken ||
        token.token_type !== "Bearer" ||
        !Number.isInteger(token.expires_in) ||
        token.expires_in <= 0 ||
        token.expires_in > MAX_ACCESS_TOKEN_SECONDS
      )
        throw failure("INVALID_RESPONSE")
      if (this.#now() >= record.refreshTokenExpiresAt) throw failure("AUTHORIZATION_REQUIRED")
      await this.write(async () => {
        this.assertCurrent(owner)
        await this.store(next)
        this.assertCurrent(owner)
        this.#record = next
      })
    } catch (error: unknown) {
      if (this.isCurrent(owner)) this.#record = null
      throw error
    }
  }

  private async store(record: OAuthDesktopSession): Promise<void> {
    try {
      await this.#vault.set("membership:session", JSON.stringify(record))
    } catch {
      throw failure("SAFE_STORAGE_UNAVAILABLE")
    }
  }

  private assertCurrent(owner: number): void {
    if (!this.isCurrent(owner)) throw failure("AUTHORIZATION_CANCELLED")
  }

  private write<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.#writes.then(operation)
    this.#writes = pending.then(
      () => undefined,
      () => undefined,
    )
    return pending
  }
}

/** 只提取固定错误标识，不使用远端原始错误文本。 */
export function codeOf(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "SERVER_UNAVAILABLE"
}
function failure(code: string): PigclaudeApiError {
  return new PigclaudeApiError(code, 0)
}
