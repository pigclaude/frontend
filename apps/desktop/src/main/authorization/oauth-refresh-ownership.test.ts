// 负责以显式屏障证明刷新、恢复、退出和新授权共享归属及持久一次消费保护。
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { expect, it, vi } from "vitest"
import { OAuthTokenManager } from "./oauth-token-manager"
import { FileSecretVault } from "../secret-vault"
import {
  deferred,
  fixtureSafeStorage,
  oauthSessionFixture,
  ProfileVault,
} from "../testing/profile-fixture"
import type { NativeOAuthToken } from "../api/oauth-client"

const rotated = (): NativeOAuthToken => ({
  access_token: "rotated-access",
  refresh_token: "rotated-refresh",
  token_type: "Bearer",
  expires_in: 300,
  scope: oauthSessionFixture().scope,
})
function setup() {
  const vault = new ProfileVault()
  vault.values.set(
    "membership:session",
    JSON.stringify({ ...oauthSessionFixture(), accessTokenExpiresAt: 1_000 }),
  )
  const entered = deferred<void>()
  const response = deferred<NativeOAuthToken>()
  const refreshToken = vi.fn(async () => {
    entered.resolve(undefined)
    return response.promise
  })
  const manager = new OAuthTokenManager({ vault, api: { refreshToken }, now: () => 2_000 })
  return { vault, entered, response, refreshToken, manager }
}

it("ten requests join one explicitly blocked consuming HTTP and disk has no old recoverable token", async () => {
  const f = setup()
  const requests = Array.from({ length: 10 }, () => f.manager.accessToken())
  await f.entered.promise
  expect(await f.vault.get("membership:session")).toBeNull()
  expect(f.refreshToken).toHaveBeenCalledTimes(1)
  f.response.resolve(rotated())
  expect(await Promise.all(requests)).toEqual(Array(10).fill("rotated-access"))
})

it("process disappearance before refresh catch leaves no old refresh in a real durable vault", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-refresh-crash-"))
  try {
    const path = join(directory, "secrets.json")
    const vault = new FileSecretVault(path, fixtureSafeStorage)
    await vault.set(
      "membership:session",
      JSON.stringify({ ...oauthSessionFixture(), accessTokenExpiresAt: 1_000 }),
    )
    const entered = deferred<void>()
    const response = deferred<NativeOAuthToken>()
    const refreshToken = vi.fn(async () => {
      entered.resolve(undefined)
      return response.promise
    })
    const original = new OAuthTokenManager({ vault, api: { refreshToken }, now: () => 2_000 })
    const pending = original.accessToken().catch((error: unknown) => error)
    await entered.promise
    const restarted = new OAuthTokenManager({
      vault: new FileSecretVault(path, fixtureSafeStorage),
      api: { refreshToken },
      now: () => 2_000,
    })
    await expect(restarted.accessToken()).rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" })
    expect(refreshToken).toHaveBeenCalledTimes(1)
    await original.suspend()
    response.resolve(rotated())
    expect(await pending).toMatchObject({ code: "AUTHORIZATION_CANCELLED" })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it.each(["logout", "new-grant"])(
  "%s wins over an old refresh HTTP without awaiting its response",
  async (action) => {
    const f = setup()
    const pending = f.manager.accessToken().catch((error: unknown) => error)
    await f.entered.promise
    if (action === "logout") {
      await f.manager.suspend()
      await f.manager.clear()
      f.manager.resume()
    } else
      await f.manager.adopt({
        ...oauthSessionFixture(),
        accessToken: "new-grant-access",
        refreshToken: "new-grant-refresh",
      })
    f.response.resolve(rotated())
    expect(await pending).toMatchObject({ code: "AUTHORIZATION_CANCELLED" })
    if (action === "logout") expect(await f.vault.get("membership:session")).toBeNull()
    else expect(await f.vault.get("membership:session")).toContain("new-grant-refresh")
  },
)

it("preparatory local await checks original owner before sending potentially consuming HTTP", async () => {
  const f = setup()
  const localEntered = deferred<void>()
  const release = deferred<void>()
  const remove = f.vault.delete.bind(f.vault)
  f.vault.delete = async (key) => {
    localEntered.resolve(undefined)
    await release.promise
    await remove(key)
  }
  const pending = f.manager.accessToken().catch((error: unknown) => error)
  await localEntered.promise
  const replacement = f.manager.adopt({
    ...oauthSessionFixture(),
    refreshToken: "new-grant-refresh",
  })
  release.resolve(undefined)
  await replacement
  expect(await pending).toMatchObject({ code: "AUTHORIZATION_CANCELLED" })
  expect(f.refreshToken).not.toHaveBeenCalled()
  expect(await f.vault.get("membership:session")).toContain("new-grant-refresh")
})

it("logout waits an entered replacement write but not the HTTP, then removes it", async () => {
  const f = setup()
  const writing = deferred<void>()
  const release = deferred<void>()
  f.vault.beforeSet = async () => {
    writing.resolve(undefined)
    await release.promise
  }
  const pending = f.manager.accessToken().catch((error: unknown) => error)
  await f.entered.promise
  f.response.resolve(rotated())
  await writing.promise
  let cleared = false
  const clearing = f.manager
    .suspend()
    .then(() => f.manager.clear())
    .then(() => {
      cleared = true
    })
  expect(cleared).toBe(false)
  release.resolve(undefined)
  await clearing
  expect(await pending).toMatchObject({ code: "AUTHORIZATION_CANCELLED" })
  expect(await f.vault.get("membership:session")).toBeNull()
})

it("a restore already reading disk cannot adopt an old record after a new grant", async () => {
  const f = setup()
  const entered = deferred<void>()
  const release = deferred<void>()
  const old = await f.vault.get("membership:session")
  f.vault.get = async () => {
    entered.resolve(undefined)
    await release.promise
    return old
  }
  const loading = f.manager.snapshot().catch((error: unknown) => error)
  await entered.promise
  await f.manager.adopt({ ...oauthSessionFixture(), refreshToken: "new-grant-refresh" })
  release.resolve(undefined)
  expect(await loading).toMatchObject({ code: "AUTHORIZATION_CANCELLED" })
  expect((await f.manager.snapshot())?.record.refreshToken).toBe("new-grant-refresh")
})

it("a late old invalid_token does not rotate an already rotated token twice", async () => {
  const f = setup()
  await f.manager.adopt(oauthSessionFixture())
  const oldEntered = deferred<void>()
  const oldRelease = deferred<void>()
  const older = f.manager.run(async ({ record }) => {
    if (record.accessToken === "new-fixture-access") {
      oldEntered.resolve(undefined)
      await oldRelease.promise
      throw Object.assign(new Error(), { code: "invalid_token" })
    }
    return record.accessToken
  })
  await oldEntered.promise
  const newer = f.manager.run(async ({ record }) => {
    if (record.accessToken === "new-fixture-access")
      throw Object.assign(new Error(), { code: "invalid_token" })
    return record.accessToken
  })
  await f.entered.promise
  const joining = f.manager.accessToken()
  f.response.resolve(rotated())
  expect(await newer).toBe("rotated-access")
  expect(await joining).toBe("rotated-access")
  oldRelease.resolve(undefined)
  expect(await older).toBe("rotated-access")
  expect(f.refreshToken).toHaveBeenCalledTimes(1)
})

it.each([
  "MEMBERSHIP_EXPIRED",
  "insufficient_scope",
  "access_denied",
  "SERVER_UNAVAILABLE",
  "ACCOUNT_BANNED",
  "DEVICE_REVOKED",
])("does not refresh business %s", async (code) => {
  const f = setup()
  await f.manager.adopt(oauthSessionFixture())
  await expect(
    f.manager.run(async () => {
      throw Object.assign(new Error(), { code })
    }),
  ).rejects.toMatchObject({ code })
  expect(f.refreshToken).not.toHaveBeenCalled()
})

it("preserves the original ceiling and absolute expiry across restricted then normal refresh", async () => {
  const f = setup()
  const pending = f.manager.accessToken()
  await f.entered.promise
  f.response.resolve({ ...rotated(), scope: "user:read device:revoke" })
  await pending
  const restricted = (await f.manager.snapshot())!.record
  expect(restricted.grantedScope).toBe(oauthSessionFixture().scope)
  const refreshToken = vi.fn(async () => ({ ...rotated(), refresh_token: "second-refresh" }))
  const recreated = new OAuthTokenManager({
    vault: f.vault,
    api: { refreshToken },
    now: () => 303_000,
  })
  await recreated.accessToken()
  expect((await recreated.snapshot())?.record.scope).toBe(oauthSessionFixture().scope)
  expect((await recreated.snapshot())?.record.refreshTokenExpiresAt).toBe(
    restricted.refreshTokenExpiresAt,
  )
})

it("never widens an original restricted ceiling based on a response", async () => {
  const f = setup()
  await f.manager.adopt({
    ...oauthSessionFixture(),
    accessTokenExpiresAt: 1_000,
    scope: "user:read",
    grantedScope: "user:read",
  })
  const pending = f.manager.accessToken().catch((error: unknown) => error)
  await f.entered.promise
  f.response.resolve(rotated())
  expect(await pending).toMatchObject({ code: "INVALID_RESPONSE" })
  expect(await f.vault.get("membership:session")).toBeNull()
})
