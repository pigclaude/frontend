// 负责为本机退出测试提供脱敏快照、可控异步边界和内存安全仓库。
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { PigclaudeApi } from "../api/pigclaude-api-client"
import type { SafeStoragePort, SecretVault } from "../secret-vault"

/** 创建可显式完成的异步边界，避免测试依赖睡眠或调度猜测。 */
export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

/** 创建独立的会员快照夹具，不调用生产视图构造函数。 */
export function membershipView(state: MembershipView["state"] = "active"): MembershipView {
  return {
    startupPhase: "settled",
    revision: 1,
    state,
    account: null,
    productCode: "pigclaude",
    planKind: "week",
    lifetime: false,
    membershipValidUntil: null,
    offlineValidUntil: null,
    lastVerifiedAt: null,
    nextVerificationAt: null,
    bindingEpoch: "2",
    errorCode: null,
    serverReason: null,
    authorizationUrl: null,
  }
}

/** 提供不会接触网络的 Rust 端口，任何错误的远程撤销都会直接失败。 */
export function profileApi(overrides: Partial<PigclaudeApi> = {}): PigclaudeApi {
  return {
    startAuthorization: async (input) => ({
      flowId: "flow-fixture",
      authorizationUrl: `http://127.0.0.1:8788/authorize/flow-fixture?state=${input.state}`,
      expiresAt: 601_000,
    }),
    exchangeAuthorization: async () => ({
      deviceId: "device-fixture",
      bindingEpoch: "2",
      userId: "user-fixture",
      sessionCookie: "new-fixture-cookie",
    }),
    inspectMembership: async () => membershipView(),
    revokeDevice: async () => {
      throw new Error("Local sign-out must not revoke the remote device")
    },
    ...overrides,
  }
}

/** 使用测试专用编码替换系统加密，不读取真实 Keychain。 */
export const fixtureSafeStorage: SafeStoragePort = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`fixture-encrypted:${value}`),
  decryptString: (value) => value.toString().slice("fixture-encrypted:".length),
}

/** 内存仓库支持显式写入阻塞和清理失败，用于本机代次竞态回归。 */
export class ProfileVault implements SecretVault {
  readonly values = new Map<string, string>()
  beforeSet?: (key: string) => Promise<void>
  failCleanup = false

  /** 写入前允许测试控制异步边界。 */
  async set(key: string, value: string): Promise<void> {
    await this.beforeSet?.(key)
    this.values.set(key, value)
  }

  /** 读取当前测试秘密。 */
  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null
  }

  /** 删除精确测试秘密。 */
  async delete(key: string): Promise<void> {
    this.values.delete(key)
  }

  /** 清理完整授权命名空间，可注入磁盘失败。 */
  async deletePrefix(prefix: string): Promise<void> {
    if (this.failCleanup) throw new Error("fixture disk unavailable")
    for (const key of this.values.keys()) if (key.startsWith(prefix)) this.values.delete(key)
  }
}

/** 准备同时包含会话、多个旧授权及设备身份的本机 profile。 */
export async function seedProfile(vault: SecretVault): Promise<void> {
  await vault.set(
    "membership:session",
    JSON.stringify({ deviceId: "device-fixture", bindingEpoch: "2", accountId: "user-fixture" }),
  )
  await vault.set("authorization:pigclaude-login:old-user", "old-login-secret")
  await vault.set("authorization:claude-account:other-account", "old-claude-secret")
  await vault.set("device:identity", "device-identity-sentinel")
}
