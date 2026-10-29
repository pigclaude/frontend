// 用真实组合根、HTTP客户端和磁盘安全仓库验证环境切换后的重新授权及迟到响应边界。
import { expect, it } from "vitest"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { createCrossEnvironmentClientFixture } from "../testing/cross-environment-client-fixture"
import { deferred } from "../testing/profile-fixture"

it("a late old identity response cannot commit after new-environment invalid_grant", async () => {
  const f = await createCrossEnvironmentClientFixture()
  try {
    const app = f.createComposition()
    await app.authorizationService.start(f.request, f.redirect)
    const state = app.authorizationService.getActiveSession()?.state
    const callback = app.authorizationService.handleCallback(
      `${f.redirect}?code=old-code&state=${state}`,
    )
    await f.sessionEntered.promise
    f.mode = "invalid"
    expect(await app.membershipGate.inspect()).toMatchObject({
      state: "verification_required",
      errorCode: "invalid_grant",
    })
    expect(await f.vault.get("membership:session")).toBeNull()
    f.releaseSession.resolve(undefined)
    expect((await callback).status).not.toBe("completed")
    expect(await f.vault.get("membership:session")).toBeNull()
    expect(f.refreshRequests()).toEqual([f.original.refreshToken])
  } finally {
    await f.close()
  }
})

it("invalid_grant removes the durable recovery entry and a restarted composition never replays it", async () => {
  const f = await createCrossEnvironmentClientFixture()
  try {
    const device = await f.identity.read()
    const app = f.createComposition()
    f.mode = "invalid"
    expect(await app.resume()).toMatchObject({
      state: "verification_required",
      errorCode: "invalid_grant",
    })
    expect(f.refreshRequests()).toEqual([f.original.refreshToken])
    expect(await f.vault.get("membership:session")).toBeNull()
    await app.dispose()
    const restarted = f.createComposition(true)
    expect(await restarted.resume()).toMatchObject({ state: "signed_out" })
    expect(f.refreshRequests()).toEqual([f.original.refreshToken])
    expect(await f.identity.read()).toEqual(device)
    expect(await readFile(join(f.directory, "accounts.json"))).toEqual(f.preserved.accounts)
    expect(await readFile(join(f.directory, "proxies.json"))).toEqual(f.preserved.proxies)
    expect(await f.vault.get("authorization:claude-account:local-claude")).toBe(
      "synthetic-claude-vault-secret",
    )
    expect(await f.vault.get("device:identity")).toBe("independent-device-sentinel")
    f.mode = "active"
    await restarted.authorizationService.start(f.request, f.redirect)
    const state = restarted.authorizationService.getActiveSession()?.state
    expect(
      await restarted.authorizationService.handleCallback(
        `${f.redirect}?code=fresh-code&state=${state}`,
      ),
    ).toMatchObject({ status: "completed", accountId: f.original.userId })
    expect(await restarted.resume()).toMatchObject({ state: "active", bindingEpoch: "1" })
    expect(await f.vault.get("membership:session")).toContain("synthetic-fresh-refresh")
    expect(f.refreshRequests()).toEqual([f.original.refreshToken])
  } finally {
    await f.close()
  }
})

it("an invalid_grant from a membership action also cancels an earlier login candidate", async () => {
  const f = await createCrossEnvironmentClientFixture()
  const operationEntered = deferred<AbortSignal>()
  const operationRelease = deferred<void>()
  try {
    const app = f.createComposition()
    const view = await app.resume()
    expect(view.state).toBe("active")
    const running = app
      .runAuthorized(async (signal) => {
        operationEntered.resolve(signal)
        await operationRelease.promise
      })
      .catch((error: unknown) => error)
    const signal = await operationEntered.promise
    await app.authorizationService.start(f.request, f.redirect)
    const state = app.authorizationService.getActiveSession()?.state
    const callback = app.authorizationService.handleCallback(
      `${f.redirect}?code=old-code&state=${state}`,
    )
    await f.sessionEntered.promise
    await expect(app.openMembershipWebsite(view.actionContextId!)).rejects.toMatchObject({
      code: "invalid_grant",
    })
    expect(signal.aborted).toBe(true)
    operationRelease.resolve(undefined)
    expect(await running).toMatchObject({ message: "MEMBERSHIP_REQUIRED" })
    f.releaseSession.resolve(undefined)
    expect((await callback).status).not.toBe("completed")
    expect(await f.vault.get("membership:session")).toBeNull()
    expect(f.refreshRequests()).toEqual([f.original.refreshToken])
  } finally {
    operationRelease.resolve(undefined)
    await f.close()
  }
})

it("a late old refresh invalid_grant cannot invalidate an explicitly committed new grant", async () => {
  const f = await createCrossEnvironmentClientFixture()
  try {
    const app = f.createComposition()
    f.mode = "invalid"
    f.holdRefresh = true
    const old = app.resume()
    await f.refreshEntered.promise
    expect(await f.vault.get("membership:session")).toBeNull()
    f.mode = "active"
    await app.membershipGate.acceptAuthorization({
      ...f.original,
      accessToken: "synthetic-new-grant-access",
      refreshToken: "synthetic-new-grant-refresh",
    })
    expect(await app.resume()).toMatchObject({ state: "active" })
    f.releaseRefresh.resolve(undefined)
    expect(await old).toMatchObject({ state: "active", errorCode: null })
    expect(await f.vault.get("membership:session")).toContain("synthetic-new-grant-refresh")
    expect(f.refreshRequests()).toEqual([f.original.refreshToken])
  } finally {
    await f.close()
  }
})

it("membership expiry with valid identity preserves the session and does not refresh", async () => {
  const f = await createCrossEnvironmentClientFixture()
  try {
    f.mode = "expired"
    const app = f.createComposition()
    expect(await app.resume()).toMatchObject({ state: "expired", errorCode: null })
    expect(f.refreshRequests()).toEqual([])
    expect(await f.vault.get("membership:session")).toContain(f.original.refreshToken)
    expect(await readFile(join(f.directory, "accounts.json"))).toEqual(f.preserved.accounts)
    await app.dispose()
    expect(await f.createComposition(true).resume()).toMatchObject({
      state: "expired",
      errorCode: null,
    })
    expect(f.refreshRequests()).toEqual([])
  } finally {
    await f.close()
  }
})
