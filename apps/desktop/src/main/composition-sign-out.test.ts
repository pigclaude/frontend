// 负责验证真实 composition 的持久化本机退出、授权竞态及重新授权，不撤销远程设备。
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { DesktopAuthorizationExchangeResponse } from "@pigclaude/contracts/desktop-membership"
import { createDesktopComposition } from "./composition"
import { FileSecretVault } from "./secret-vault"
import {
  deferred,
  fixtureSafeStorage,
  membershipView,
  profileApi,
  ProfileVault,
  seedProfile,
} from "./testing/profile-fixture"

const options = {
  authOrigin: "http://127.0.0.1:8788",
  now: () => 1_000,
  deviceIdentity: {
    read: async () => ({ deviceId: "pcd_" + "1".repeat(64), platform: "darwin" as const }),
  },
}
const request = { purpose: "pigclaude-login", mode: "login" } as const
const redirect = "http://127.0.0.1:43123/oauth/callback"

describe("DesktopComposition local sign-out", () => {
  it("clears every authorization on disk, preserves identity, stays signed out on restart and permits reauthorization", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-profile-sign-out-"))
    try {
      const path = join(directory, "secrets.json")
      const vault = new FileSecretVault(path, fixtureSafeStorage)
      await seedProfile(vault)
      const composition = createDesktopComposition({ ...options, vault, api: profileApi() })
      await composition.membershipGate.inspect()

      await expect(composition.signOut()).resolves.toMatchObject({ state: "signed_out" })
      expect(await vault.get("authorization:pigclaude-login:old-user")).toBeNull()
      expect(await vault.get("authorization:claude-account:other-account")).toBeNull()
      expect(await vault.get("membership:session")).toBeNull()
      expect(await vault.get("device:identity")).toBe("device-identity-sentinel")
      await composition.dispose()

      const restarted = createDesktopComposition({
        ...options,
        vault: new FileSecretVault(path, fixtureSafeStorage),
        api: profileApi(),
      })
      expect(await restarted.membershipGate.inspect()).toMatchObject({ state: "signed_out" })
      await restarted.authorizationService.start(request, redirect)
      const state = restarted.authorizationService.getActiveSession()?.state
      expect(
        await restarted.authorizationService.handleCallback(`${redirect}?code=new&state=${state}`),
      ).toMatchObject({ status: "completed" })
      expect(restarted.membershipGate.view()).toMatchObject({ state: "active" })
      expect(await vault.get("membership:session")).toContain("new-fixture-cookie")
      await restarted.signOut()
      await restarted.dispose()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("ignores a remote inspect that finishes after local sign-out", async () => {
    const vault = new ProfileVault()
    await seedProfile(vault)
    const inspected = deferred<void>()
    const response = deferred<MembershipView>()
    const composition = createDesktopComposition({
      ...options,
      vault,
      api: profileApi({
        inspectMembership: async () => {
          inspected.resolve(undefined)
          return response.promise
        },
      }),
    })
    const pending = composition.membershipGate.inspect()
    await inspected.promise
    await composition.signOut()
    response.resolve(membershipView())
    await pending
    expect(composition.membershipGate.view()).toMatchObject({ state: "signed_out" })
    expect(await vault.get("membership:session")).toBeNull()
    await composition.dispose()
  })

  it("invalidates an unfinished start so its late response cannot create a callback session", async () => {
    const vault = new ProfileVault()
    await seedProfile(vault)
    const entered = deferred<void>()
    const release = deferred<void>()
    const composition = createDesktopComposition({
      ...options,
      vault,
      api: profileApi({
        startAuthorization: async (input) => {
          entered.resolve(undefined)
          await release.promise
          return {
            flowId: "old-flow",
            authorizationUrl: `http://127.0.0.1:8788/authorize/old?state=${input.state}`,
            expiresAt: 601_000,
          }
        },
      }),
    })
    const pending = composition.authorizationService
      .start(request, redirect)
      .catch((error: unknown) => error)
    await entered.promise
    await composition.signOut()
    release.resolve(undefined)

    expect(await pending).toMatchObject({ status: "cancelled" })
    expect(composition.authorizationService.getActiveSession()).toBeNull()
    expect(await vault.get("membership:session")).toBeNull()
    await composition.dispose()
  })

  it("rejects old exchange and callback results after logout and a fresh login", async () => {
    const vault = new ProfileVault()
    await seedProfile(vault)
    const entered = deferred<void>()
    const response = deferred<DesktopAuthorizationExchangeResponse>()
    const composition = createDesktopComposition({
      ...options,
      vault,
      api: profileApi({
        exchangeAuthorization: async (input) => {
          if (input.code === "old") {
            entered.resolve(undefined)
            return response.promise
          }
          return {
            deviceId: "device-fixture",
            bindingEpoch: "2",
            userId: "new-user",
            sessionCookie: "fresh-cookie",
          }
        },
      }),
    })
    await composition.authorizationService.start(request, redirect)
    const oldState = composition.authorizationService.getActiveSession()?.state
    const oldCallback = `${redirect}?code=old&state=${oldState}`
    const pending = composition.authorizationService.handleCallback(oldCallback)
    await entered.promise
    await composition.signOut()
    await composition.authorizationService.start(request, redirect)
    const newState = composition.authorizationService.getActiveSession()?.state
    expect(await composition.authorizationService.handleCallback(oldCallback)).toMatchObject({
      status: "state-mismatch",
    })
    expect(
      await composition.authorizationService.handleCallback(
        `${redirect}?code=fresh&state=${newState}`,
      ),
    ).toMatchObject({ status: "completed" })
    response.resolve({
      deviceId: "device-fixture",
      bindingEpoch: "1",
      userId: "old-user",
      sessionCookie: "stale-cookie",
    })
    expect(await pending).toMatchObject({ status: "cancelled" })
    expect(await vault.get("membership:session")).toContain("fresh-cookie")
    expect(await vault.get("membership:session")).not.toContain("stale-cookie")
    expect(composition.membershipGate.view()).toMatchObject({ state: "active", bindingEpoch: "2" })
    await composition.dispose()
  })

  it("drains an already running local write before clearing the profile", async () => {
    const vault = new ProfileVault()
    await seedProfile(vault)
    const entered = deferred<void>()
    const release = deferred<void>()
    vault.beforeSet = async (key) => {
      if (key !== "membership:session") return
      entered.resolve(undefined)
      await release.promise
    }
    const composition = createDesktopComposition({ ...options, vault, api: profileApi() })
    await composition.authorizationService.start(request, redirect)
    const state = composition.authorizationService.getActiveSession()?.state
    const pending = composition.authorizationService.handleCallback(
      `${redirect}?code=old&state=${state}`,
    )
    await entered.promise
    const signingOut = composition.signOut()
    release.resolve(undefined)
    await signingOut
    expect(await pending).toMatchObject({ status: "cancelled" })
    expect(await vault.get("membership:session")).toBeNull()
    expect(composition.membershipGate.view()).toMatchObject({ state: "signed_out" })
    await composition.dispose()
  })

  it("reports cleanup failure, blocks stale inspect recovery and permits an explicit retry", async () => {
    const vault = new ProfileVault()
    await seedProfile(vault)
    const composition = createDesktopComposition({ ...options, vault, api: profileApi() })
    await composition.membershipGate.inspect()
    vault.failCleanup = true
    await expect(composition.signOut()).rejects.toThrow("fixture disk unavailable")
    expect(await composition.membershipGate.inspect()).toMatchObject({
      state: "configuration_error",
      errorCode: "LOCAL_SIGN_OUT_FAILED",
    })
    await expect(composition.authorizationService.start(request, redirect)).rejects.toMatchObject({
      status: "cancelled",
    })
    vault.failCleanup = false
    await expect(composition.signOut()).resolves.toMatchObject({ state: "signed_out" })
    expect(await vault.get("membership:session")).toBeNull()
    await composition.authorizationService.start(request, redirect)
    const state = composition.authorizationService.getActiveSession()?.state
    expect(
      await composition.authorizationService.handleCallback(
        `${redirect}?code=retry&state=${state}`,
      ),
    ).toMatchObject({ status: "completed" })
    expect(composition.membershipGate.view()).toMatchObject({ state: "active" })
    expect(await vault.get("membership:session")).toContain("new-fixture-cookie")
    await composition.dispose()
  })
})
