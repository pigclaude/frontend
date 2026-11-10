// 验证浏览器授权与删除、退出交错时不会误停进程或复活账号。

import { describe, expect, it } from "vitest"
import {
  createHarness,
  createWaitingCallback,
  fingerprint,
  seedAccount,
  waitForTestSignal,
} from "./account-service-test-fixtures"
import { ClaudeAccountError } from "./errors"
import { BrowserLaunchError } from "./fingerprint-chromium"

function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("Claude 账号授权生命周期", () => {
  it("deletes only after a pending authorization has stopped, without restoring the account", async () => {
    const gate = deferred()
    const entered = deferred()
    const harness = await createHarness({
      membershipWait: () => {
        entered.resolve()
        return gate.promise
      },
    })
    await harness.store.saveAccount(seedAccount())
    const authorization = harness.service
      .authorize({ accountId: "acc-1", displayName: "新名称", proxyId: null, fingerprint })
      .catch((error: unknown) => error)
    await entered.promise
    const deletion = harness.service.remove("acc-1")
    gate.resolve()
    await deletion
    expect(await authorization).toMatchObject({ code: "AUTHORIZATION_CANCELLED" })
    expect(await harness.store.getAccount("acc-1")).toBeNull()
    expect(harness.browserCalls).not.toContain("launch")
  })

  it("cancels a browser authorization before deleting its profile", async () => {
    const callback = createWaitingCallback()
    const harness = await createHarness({ callback })
    await harness.store.saveAccount(seedAccount())
    const authorization = harness.service
      .authorize({ accountId: "acc-1", displayName: "新名称", proxyId: null, fingerprint })
      .catch((error: unknown) => error)
    await harness.launched.promise
    await harness.service.remove("acc-1")
    expect(await authorization).toMatchObject({ code: "AUTHORIZATION_CANCELLED" })
    expect(harness.browserCalls.indexOf("stop")).toBeLessThan(
      harness.browserCalls.indexOf("delete"),
    )
    expect(await harness.store.getAccount("acc-1")).toBeNull()
  })

  it("does not start a pending authorization after service disposal", async () => {
    const gate = deferred()
    const entered = deferred()
    const harness = await createHarness({
      membershipWait: () => {
        entered.resolve()
        return gate.promise
      },
    })
    const authorization = harness.service
      .authorize({ displayName: "账号", proxyId: null, fingerprint })
      .catch((error: unknown) => error)
    await entered.promise
    const disposal = harness.service.dispose()
    gate.resolve()
    await disposal
    expect(await authorization).toMatchObject({ code: "AUTHORIZATION_CANCELLED" })
    expect(harness.browserCalls).not.toContain("launch")
    expect(await harness.store.getAccount("acc-1")).toBeNull()
  })

  it("rejects another valid authorization for the same account without cancelling the first", async () => {
    const callback = createWaitingCallback()
    const harness = await createHarness({ callback })
    const first = harness.service
      .authorize({ displayName: "第一个", proxyId: null, fingerprint })
      .catch((error: unknown) => error)
    await harness.launched.promise
    await expect(
      harness.service.authorize({ displayName: "第二个", proxyId: null, fingerprint }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })
    expect(harness.browserCalls.filter((call) => call === "launch")).toHaveLength(1)
    expect(harness.events.at(-1)?.phase).toBe("waiting-browser")
    await harness.service.cancel()
    expect(await first).toMatchObject({ code: "AUTHORIZATION_CANCELLED" })
  })

  it("does not publish a rejected second preflight over an earlier pending attempt", async () => {
    const gate = deferred()
    const entered = deferred()
    let calls = 0
    const harness = await createHarness({
      membershipWait: () => {
        calls++
        if (calls !== 1) return Promise.resolve()
        entered.resolve()
        return gate.promise
      },
    })
    const first = harness.service.authorize({ displayName: "第一个", proxyId: null, fingerprint })
    const outcome = first.catch((error: unknown) => error)
    await entered.promise
    await expect(
      harness.service.authorize({
        displayName: "冲突",
        proxyId: null,
        fingerprint: { ...fingerprint, unknownArgs: ["--profile-directory=.."] },
      }),
    ).rejects.toMatchObject({ code: "FINGERPRINT_INVALID" })
    expect(harness.events.at(-1)?.phase).toBe("preparing")
    const cancelling = harness.service.cancel()
    gate.resolve()
    await cancelling
    expect(await outcome).toMatchObject({ code: "AUTHORIZATION_CANCELLED" })
  })

  it("does not let a later same-account attempt overtake an earlier preflight", async () => {
    const gate = deferred()
    const entered = deferred()
    let calls = 0
    const harness = await createHarness({
      membershipWait: () => {
        calls++
        if (calls !== 1) return Promise.resolve()
        entered.resolve()
        return gate.promise
      },
    })
    const first = harness.service.authorize({ displayName: "第一个", proxyId: null, fingerprint })
    await entered.promise
    await expect(
      harness.service.authorize({ displayName: "第二个", proxyId: null, fingerprint }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" })
    expect(harness.browserCalls).not.toContain("launch")
    gate.resolve()
    expect((await first).id).toBe("acc-1")
    expect(harness.browserCalls.filter((call) => call === "launch")).toHaveLength(1)
  })

  it("does not start an overlapping attempt after the earlier one has completed", async () => {
    const gate = deferred()
    const entered = deferred()
    let resolveCode: (code: string) => void = () => undefined
    let complete = false
    const code = new Promise<string>((resolve) => {
      resolveCode = (value) => {
        complete = true
        resolve(value)
      }
    })
    let calls = 0
    const harness = await createHarness({
      callback: {
        redirectUri: "http://localhost:1234/callback",
        isComplete: () => complete,
        waitForCode: () => code,
        cancel: () => undefined,
        close: async () => undefined,
      },
      membershipWait: () => {
        calls++
        if (calls === 1) return Promise.resolve()
        entered.resolve()
        return gate.promise
      },
    })
    const first = harness.service.authorize({ displayName: "第一个", proxyId: null, fingerprint })
    await harness.launched.promise
    const second = harness.service
      .authorize({ displayName: "第二个", proxyId: null, fingerprint })
      .catch((error: unknown) => error)
    await entered.promise
    resolveCode("synthetic-code")
    expect((await first).id).toBe("acc-1")
    gate.resolve()
    expect(await second).toMatchObject({ code: "INVALID_INPUT" })
    expect(harness.browserCalls.filter((call) => call === "launch")).toHaveLength(1)
    expect(harness.events.at(-1)?.phase).toBe("authorized")
  })

  it("publishes authorization failure only after browser cleanup completes", async () => {
    const gate = deferred()
    const entered = deferred()
    let rejectCode: (error: Error) => void = () => undefined
    let complete = false
    const code = new Promise<string>((_resolve, reject) => {
      rejectCode = (error) => {
        if (complete) return
        complete = true
        reject(error)
      }
    })
    void code.catch(() => undefined)
    const harness = await createHarness({
      callback: {
        redirectUri: "http://localhost:1234/callback",
        isComplete: () => complete,
        waitForCode: () => code,
        cancel: () => rejectCode(new ClaudeAccountError("AUTHORIZATION_CANCELLED", "取消")),
        close: async () => rejectCode(new ClaudeAccountError("AUTHORIZATION_CANCELLED", "取消")),
      },
      stopWait: () => {
        entered.resolve()
        return gate.promise
      },
    })
    const result = harness.service
      .authorize({ displayName: "账号", proxyId: null, fingerprint })
      .catch((error: unknown) => error)
    try {
      await waitForTestSignal(harness.launched.promise, result)
      rejectCode(new ClaudeAccountError("OAUTH_DENIED", "拒绝"))
      await waitForTestSignal(entered.promise, result)
      expect(harness.events.at(-1)?.phase).toBe("waiting-browser")
      gate.resolve()
      expect(await result).toMatchObject({ code: "OAUTH_DENIED" })
      expect(harness.events.at(-1)).toMatchObject({ phase: "failed", errorCode: "OAUTH_DENIED" })
    } finally {
      gate.resolve()
      await harness.service.cancel().catch(() => undefined)
      await result
      await harness.cleanup()
    }
  })

  it("keeps a deletion gate until concurrent deletions finish", async () => {
    const gate = deferred()
    const entered = deferred()
    const harness = await createHarness({
      deleteWait: () => {
        entered.resolve()
        return gate.promise
      },
    })
    await harness.store.saveAccount(seedAccount())
    const first = harness.service.remove("acc-1")
    await entered.promise
    const second = harness.service.remove("acc-1")
    await expect(
      harness.service.authorize({
        accountId: "acc-1",
        displayName: "账号",
        proxyId: null,
        fingerprint,
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" })
    gate.resolve()
    await Promise.all([first, second])
    expect(harness.browserCalls.filter((call) => call === "delete")).toHaveLength(1)
    expect(await harness.store.getAccount("acc-1")).toBeNull()
  })

  it("does not resurrect a deleted account during an update", async () => {
    const gate = deferred()
    const entered = deferred()
    const harness = await createHarness()
    await harness.store.saveAccount(seedAccount())
    const getProxy = harness.store.getProxy.bind(harness.store)
    harness.store.getProxy = async (id) => {
      entered.resolve()
      await gate.promise
      return getProxy(id)
    }
    const update = harness.service.update({ accountId: "acc-1", proxyId: "p1" })
    const outcome = update.catch((error: unknown) => error)
    await entered.promise
    await harness.store.removeAccount("acc-1")
    gate.resolve()
    expect(await outcome).toMatchObject({ code: "ACCOUNT_NOT_FOUND" })
    expect(await harness.store.getAccount("acc-1")).toBeNull()
  })

  it("does not resurrect a deleted account while reimporting CLI credentials", async () => {
    const gate = deferred()
    const entered = deferred()
    const harness = await createHarness({
      profile: {
        accountUuid: "old-account",
        email: "old@example.com",
        organizationUuid: "org",
        subscriptionType: "max",
        rateLimitTier: null,
      },
      readCliCredential: async () => ({
        accessToken: "synthetic-access",
        refreshToken: "synthetic-refresh",
        refreshTokenExpiresAt: null,
        expiresAt: Date.parse("2026-10-22T00:00:00.000Z"),
        scopes: ["user:inference"],
        subscriptionType: "max",
        rateLimitTier: null,
      }),
      readCliAccountMetadata: async () => null,
    })
    await harness.store.saveAccount(seedAccount())
    const updateAccount = harness.store.updateAccount.bind(harness.store)
    harness.store.updateAccount = async (...args) => {
      entered.resolve()
      await gate.promise
      return updateAccount(...args)
    }
    const importing = harness.service.importFromClaudeCli({ confirmCopy: true })
    const outcome = importing.catch((error: unknown) => error)
    await entered.promise
    await harness.store.removeAccount("acc-1")
    gate.resolve()
    expect(await outcome).toMatchObject({ code: "ACCOUNT_NOT_FOUND" })
    expect(await harness.store.getAccount("acc-1")).toBeNull()
  })

  it("returns the saved account and reports an unconfirmed browser exit as a warning", async () => {
    const harness = await createHarness({
      stopError: new BrowserLaunchError("BROWSER_STOP_FAILED", "浏览器可能仍在运行"),
    })
    const view = await harness.service.authorize({
      displayName: "账号",
      proxyId: null,
      fingerprint,
    })
    expect(view.id).toBe("acc-1")
    expect(await harness.store.getAccount("acc-1")).not.toBeNull()
    expect(harness.events.at(-1)).toMatchObject({
      phase: "authorized",
      errorCode: "BROWSER_STOP_FAILED",
      message: "浏览器可能仍在运行",
    })
    expect(harness.events.filter((event) => event.phase === "authorized")).toHaveLength(1)
  })

  it("cancels while the callback is starting and never launches the browser", async () => {
    const gate = deferred()
    const entered = deferred()
    const harness = await createHarness({
      callbackStartWait: () => {
        entered.resolve()
        return gate.promise
      },
    })
    const authorization = harness.service
      .authorize({ displayName: "账号", proxyId: null, fingerprint })
      .catch((error: unknown) => error)
    await entered.promise
    const cancelling = harness.service.cancel()
    gate.resolve()
    await cancelling
    expect(await authorization).toMatchObject({ code: "AUTHORIZATION_CANCELLED" })
    expect(harness.browserCalls).not.toContain("launch")
  })

  it("waits for browser cleanup and reports an unconfirmed exit to the cancelling caller", async () => {
    const gate = deferred()
    const entered = deferred()
    const harness = await createHarness({
      callback: createWaitingCallback(),
      stopError: new BrowserLaunchError("BROWSER_STOP_FAILED", "浏览器可能仍在运行"),
      stopWait: () => {
        entered.resolve()
        return gate.promise
      },
    })
    const authorization = harness.service
      .authorize({ displayName: "账号", proxyId: null, fingerprint })
      .catch((error: unknown) => error)
    await harness.launched.promise
    let finished = false
    const cancelling = harness.service
      .cancel()
      .catch((error: unknown) => error)
      .then((result) => {
        finished = true
        return result
      })
    await entered.promise
    expect(finished).toBe(false)
    gate.resolve()
    expect(await cancelling).toMatchObject({ code: "BROWSER_STOP_FAILED" })
    expect(await authorization).toMatchObject({ code: "AUTHORIZATION_CANCELLED" })
    await expect(
      harness.service.authorize({ displayName: "新账号", proxyId: null, fingerprint }),
    ).rejects.toMatchObject({ code: "BROWSER_STOP_FAILED" })
    await expect(harness.service.cancel()).rejects.toMatchObject({ code: "BROWSER_STOP_FAILED" })
    expect(harness.browserCalls.filter((call) => call === "stop")).toHaveLength(2)
  })

  it("reports that cancellation is too late once saving has begun", async () => {
    const gate = deferred()
    const entered = deferred()
    const harness = await createHarness()
    const save = harness.store.saveAccount.bind(harness.store)
    harness.store.saveAccount = async (record) => {
      entered.resolve()
      await gate.promise
      await save(record)
    }
    const authorization = harness.service.authorize({
      displayName: "账号",
      proxyId: null,
      fingerprint,
    })
    await entered.promise
    await expect(harness.service.cancel()).rejects.toMatchObject({ code: "INVALID_INPUT" })
    gate.resolve()
    expect((await authorization).id).toBe("acc-1")
    expect(harness.events.at(-1)?.phase).toBe("authorized")
  })

  it("waits for an already started deletion before completing disposal", async () => {
    const gate = deferred()
    const entered = deferred()
    const harness = await createHarness({
      deleteWait: () => {
        entered.resolve()
        return gate.promise
      },
    })
    await harness.store.saveAccount(seedAccount())
    const deleting = harness.service.remove("acc-1")
    await entered.promise
    let finished = false
    const disposing = harness.service.dispose().then(() => {
      finished = true
    })
    await Promise.resolve()
    expect(finished).toBe(false)
    gate.resolve()
    await Promise.all([deleting, disposing])
    expect(await harness.store.getAccount("acc-1")).toBeNull()
  })
})
