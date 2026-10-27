// 负责验证候选保存失败后的重启一致性，以及已经消费的 refresh 不会因恢复旧登录而复活。
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { expect, it } from "vitest"
import { FileSecretVault } from "../secret-vault"
import { OAuthTokenManager } from "./oauth-token-manager"
import {
  deferred,
  fixtureSafeStorage,
  oauthSessionFixture,
  profileApi,
  ProfileVault,
} from "../testing/profile-fixture"
import type { NativeOAuthToken } from "../api/oauth-client"

it("restarts with the original committed session after an encryption failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-candidate-durable-"))
  let failEncryption = false
  const storage = {
    ...fixtureSafeStorage,
    encryptString: (value: string) => {
      if (failEncryption) throw new Error("fixture encryption unavailable")
      return fixtureSafeStorage.encryptString(value)
    },
  }
  try {
    const path = join(directory, "secrets.json")
    const vault = new FileSecretVault(path, storage)
    const original = oauthSessionFixture()
    await vault.set("membership:session", JSON.stringify(original))
    const api = profileApi()
    const manager = new OAuthTokenManager({ vault, api, now: () => 2_000 })
    await manager.snapshot()
    failEncryption = true
    await expect(
      manager.adopt({ ...original, userId: "user-b", refreshToken: "refresh-b" }),
    ).rejects.toMatchObject({ code: "SAFE_STORAGE_UNAVAILABLE" })
    expect((await manager.snapshot())?.record).toEqual(original)
    const restarted = new OAuthTokenManager({
      vault: new FileSecretVault(path, storage),
      api,
      now: () => 2_000,
    })
    expect((await restarted.snapshot())?.record).toEqual(original)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it("never restores a consumed refresh when candidate persistence also fails", async () => {
  const vault = new ProfileVault()
  await vault.set(
    "membership:session",
    JSON.stringify({ ...oauthSessionFixture(), accessTokenExpiresAt: 1_000 }),
  )
  const entered = deferred<void>()
  const response = deferred<NativeOAuthToken>()
  const api = profileApi({
    refreshToken: async () => {
      entered.resolve(undefined)
      return response.promise
    },
  })
  const manager = new OAuthTokenManager({ vault, api, now: () => 2_000 })
  const refreshing = manager.accessToken().catch((error: unknown) => error)
  await entered.promise
  vault.beforeSet = async () => {
    throw new Error("fixture disk failed")
  }
  await expect(
    manager.adopt({ ...oauthSessionFixture(), userId: "user-b", refreshToken: "refresh-b" }),
  ).rejects.toMatchObject({ code: "SAFE_STORAGE_UNAVAILABLE" })
  expect(await manager.snapshot()).toBeNull()
  response.resolve({
    access_token: "late-access",
    refresh_token: "late-refresh",
    token_type: "Bearer",
    expires_in: 300,
    scope: oauthSessionFixture().scope,
  })
  expect(await refreshing).toMatchObject({ code: "AUTHORIZATION_CANCELLED" })
  const restarted = new OAuthTokenManager({ vault, api, now: () => 2_000 })
  expect(await restarted.snapshot()).toBeNull()
})
