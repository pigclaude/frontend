// 负责验证 refresh 单飞、一次消费保护及明确的安全存储错误。
import { expect, it, vi } from "vitest"
import { OAuthTokenManager } from "./oauth-token-manager"
import { ProfileVault, oauthSessionFixture } from "../testing/profile-fixture"

function fixture() {
  const vault = new ProfileVault()
  const original = { ...oauthSessionFixture(), accessTokenExpiresAt: 1_000 }
  vault.values.set("membership:session", JSON.stringify(original))
  const refreshToken = vi.fn(async () => ({
    access_token: "rotated-access",
    refresh_token: "rotated-refresh",
    token_type: "Bearer" as const,
    expires_in: 300,
    scope: original.scope,
  }))
  const manager = new OAuthTokenManager({ vault, api: { refreshToken }, now: () => 2_000 })
  return { vault, original, refreshToken, manager }
}

it("ten expired access requests consume one refresh and persist a complete replacement", async () => {
  const { manager, refreshToken, vault, original } = fixture()
  const tokens = await Promise.all(Array.from({ length: 10 }, () => manager.accessToken()))
  expect(refreshToken).toHaveBeenCalledTimes(1)
  expect(tokens).toEqual(Array(10).fill("rotated-access"))
  expect(JSON.parse((await vault.get("membership:session"))!)).toMatchObject({
    accessToken: "rotated-access",
    refreshToken: "rotated-refresh",
    refreshTokenExpiresAt: original.refreshTokenExpiresAt,
    accessTokenExpiresAt: 302_000,
  })
})

it("lost refresh response never reuses the old refresh, including a recreated manager", async () => {
  const { manager, refreshToken, vault } = fixture()
  refreshToken.mockRejectedValue(
    Object.assign(new Error("unavailable"), { code: "SERVER_UNAVAILABLE" }),
  )
  await expect(manager.accessToken()).rejects.toMatchObject({ code: "SERVER_UNAVAILABLE" })
  await expect(manager.accessToken()).rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" })
  const recreated = new OAuthTokenManager({ vault, api: { refreshToken }, now: () => 2_000 })
  await expect(recreated.accessToken()).rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" })
  expect(refreshToken).toHaveBeenCalledTimes(1)
})

it("safeStorage replacement failure does not restore consumed refresh", async () => {
  const { manager, refreshToken, vault } = fixture()
  vault.beforeSet = async () => {
    throw new Error("disk failed")
  }
  await expect(manager.accessToken()).rejects.toMatchObject({ code: "SAFE_STORAGE_UNAVAILABLE" })
  await expect(manager.accessToken()).rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" })
  expect(refreshToken).toHaveBeenCalledTimes(1)
  expect(await vault.get("membership:session")).toBeNull()
})

it.each(["invalid_grant", "ACCOUNT_BANNED", "DEVICE_REVOKED"])(
  "refresh %s consumes once and requires new authorization",
  async (code) => {
    const { manager, refreshToken, vault } = fixture()
    refreshToken.mockRejectedValue(Object.assign(new Error("fixed"), { code }))
    await expect(manager.accessToken()).rejects.toMatchObject({ code })
    await expect(manager.accessToken()).rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" })
    expect(refreshToken).toHaveBeenCalledTimes(1)
    expect(await vault.get("membership:session")).toBeNull()
  },
)

it("preparation storage failure sends zero HTTP and retains the never-consumed refresh", async () => {
  const { manager, refreshToken, vault } = fixture()
  const remove = vault.delete.bind(vault)
  vault.delete = async () => {
    throw new Error("disk")
  }
  await expect(manager.accessToken()).rejects.toMatchObject({ code: "SAFE_STORAGE_UNAVAILABLE" })
  expect(refreshToken).not.toHaveBeenCalled()
  expect(await vault.get("membership:session")).toContain("new-fixture-refresh")
  vault.delete = remove
  expect(await manager.accessToken()).toBe("rotated-access")
  expect(refreshToken).toHaveBeenCalledTimes(1)
})

it("accepts the server's one-hour access lifetime and rejects anything longer", async () => {
  const hour = fixture()
  hour.refreshToken.mockResolvedValueOnce({
    access_token: "hour-access",
    refresh_token: "hour-refresh",
    token_type: "Bearer",
    expires_in: 3600,
    scope: hour.original.scope,
  })
  await expect(hour.manager.accessToken()).resolves.toBe("hour-access")
  expect(JSON.parse((await hour.vault.get("membership:session"))!)).toMatchObject({
    accessTokenExpiresAt: 2_000 + 3_600_000,
  })
  const longer = fixture()
  longer.refreshToken.mockResolvedValueOnce({
    access_token: "long-access",
    refresh_token: "long-refresh",
    token_type: "Bearer",
    expires_in: 3601,
    scope: longer.original.scope,
  })
  await expect(longer.manager.accessToken()).rejects.toMatchObject({ code: "INVALID_RESPONSE" })
})
