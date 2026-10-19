// 负责验证本机退出同步取消刷新归属，且不影响其他用途的秘密。
import { expect, it, vi } from "vitest"
import { OAuthTokenManager } from "./oauth-token-manager"
import { ProfileVault, seedProfile } from "../testing/profile-fixture"

it("suspend immediately denies access and clear removes only first-party materials", async () => {
  const vault = new ProfileVault()
  await seedProfile(vault)
  const refreshToken = vi.fn()
  const manager = new OAuthTokenManager({ vault, api: { refreshToken }, now: () => 1_000 })
  const barrier = manager.suspend()
  await expect(manager.accessToken()).rejects.toMatchObject({ code: "AUTHORIZATION_CANCELLED" })
  await barrier
  await manager.clear()
  expect(await vault.get("membership:session")).toBeNull()
  expect(await vault.get("authorization:pigclaude-login:old-user")).toBeNull()
  expect(await vault.get("authorization:claude-account:other-account")).toBe("old-claude-secret")
  expect(await vault.get("device:identity")).toBe("device-identity-sentinel")
  expect(refreshToken).not.toHaveBeenCalled()
})
