// 负责验证 Electron 会员 gate 的服务端判定、恢复、订阅和撤销清理边界。
import { describe, expect, it } from "vitest"
import type { MembershipView } from "@pigclaude/contracts/membership"
import { MembershipGate, type MembershipGateApi } from "./membership-gate"
import type { SecretVault } from "../secret-vault"

class MemoryVault implements SecretVault {
  readonly values = new Map<string, string>()

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value)
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key)
  }
}

function view(
  state: MembershipView["state"] | "inactive" | "revoked",
  bindingEpoch: string | null = "2",
): MembershipView {
  return {
    startupPhase: "settled",
    revision: 1,
    state: state as MembershipView["state"],
    account: { userId: "user-1", nickname: "林舟", email: "user@example.com", avatar: "" },
    productCode: "pigclaude",
    planKind: "week",
    lifetime: false,
    membershipValidUntil: null,
    offlineValidUntil: null,
    lastVerifiedAt: "2026-10-18T00:00:00Z",
    nextVerificationAt: null,
    bindingEpoch,
    errorCode: null,
    serverReason: null,
    authorizationUrl: null,
  }
}

function sessionRecord() {
  return {
    accessToken: "access-secret",
    refreshToken: "refresh-secret",
    credential: "credential-secret",
    sessionCookie: "pigclaude_session=session-secret",
    deviceId: "device-1",
    bindingEpoch: "2",
    accountId: "user-1",
  }
}

function api(overrides: Partial<MembershipGateApi> = {}): MembershipGateApi {
  return {
    inspectMembership: async () => view("active"),
    revokeDevice: async () => undefined,
    ...overrides,
  }
}

describe("MembershipGate", () => {
  it("restores an encrypted session record before inspecting the Rust server", async () => {
    const vault = new MemoryVault()
    await vault.set("membership:session", JSON.stringify(sessionRecord()))
    let inspected: { deviceId: string; bindingEpoch: string | null } | undefined
    const gate = new MembershipGate({
      api: api({
        inspectMembership: async (input) => {
          inspected = input
          return view("active")
        },
      }),
      vault,
      now: () => 1_000,
    })

    await expect(gate.inspect()).resolves.toMatchObject({ state: "active", bindingEpoch: "2" })
    expect(inspected).toEqual({ deviceId: "device-1", bindingEpoch: "2" })
  })

  it.each([
    ["inactive", "verification_required"],
    ["expired", "expired"],
    ["revoked", "verification_required"],
    ["device_revoked", "device_revoked"],
  ] as const)("maps server %s to a clear renderer gate state", async (serverState, expected) => {
    const vault = new MemoryVault()
    await vault.set("membership:session", JSON.stringify(sessionRecord()))
    const gate = new MembershipGate({
      api: api({ inspectMembership: async () => view(serverState) }),
      vault,
    })

    await expect(gate.inspect()).resolves.toMatchObject({ state: expected })
  })

  it("marks unavailable and stale binding responses without falling back to local active state", async () => {
    const vault = new MemoryVault()
    await vault.set("membership:session", JSON.stringify(sessionRecord()))
    const unavailable = new MembershipGate({
      api: api({
        inspectMembership: async () => {
          throw new Error("SERVER_UNAVAILABLE")
        },
      }),
      vault,
    })
    await expect(unavailable.inspect()).resolves.toMatchObject({ state: "error" })

    const stale = new MembershipGate({
      api: api({ inspectMembership: async () => view("active", "3") }),
      vault,
    })
    await expect(stale.inspect()).resolves.toMatchObject({
      state: "device_revoked",
      errorCode: "AUTHORIZATION_BINDING_STALE",
    })
  })

  it("publishes sanitized views and revoke removes every local secret", async () => {
    const vault = new MemoryVault()
    await vault.set("membership:session", JSON.stringify(sessionRecord()))
    await vault.set("authorization:pigclaude-login:user-1", JSON.stringify(sessionRecord()))
    let published: MembershipView | undefined
    const gate = new MembershipGate({
      api: api({ inspectMembership: async () => view("active") }),
      vault,
    })
    const unsubscribe = gate.subscribe((next) => {
      published = next
    })

    await gate.inspect()
    expect(JSON.stringify(published)).not.toContain("access-secret")
    expect(JSON.stringify(published)).not.toContain("credential-secret")
    await gate.revoke()
    unsubscribe()
    expect(vault.values.has("membership:session")).toBe(false)
    expect(vault.values.has("authorization:pigclaude-login:user-1")).toBe(false)
  })
})

it("keeps safeStorage material after unavailable inspect and recovers with the same session", async () => {
  const vault = new MemoryVault()
  const raw = JSON.stringify(sessionRecord())
  await vault.set("membership:session", raw)
  let online = false
  const gate = new MembershipGate({
    vault,
    api: api({
      inspectMembership: async () => {
        if (!online) throw Object.assign(new Error("unavailable"), { code: "SERVER_UNAVAILABLE" })
        return view("active")
      },
    }),
  })
  expect(gate.view().startupPhase).toBe("checking")
  expect(await gate.inspect()).toMatchObject({ state: "error", errorCode: "SERVER_UNAVAILABLE" })
  expect(await vault.get("membership:session")).toBe(raw)
  online = true
  expect(await gate.inspect()).toMatchObject({ state: "active" })
  expect(await vault.get("membership:session")).toBe(raw)
})

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

it.each(["result", "timeout"])(
  "ignores old startup inspect %s after a new authorization succeeds",
  async (outcome) => {
    const vault = new MemoryVault()
    await vault.set("membership:session", JSON.stringify(sessionRecord()))
    const old = deferred<MembershipView>()
    let count = 0
    const entered = deferred<void>()
    const gate = new MembershipGate({
      vault,
      api: api({
        inspectMembership: async () => {
          if (++count === 1) {
            entered.resolve(undefined)
            return old.promise
          }
          return view("active", "3")
        },
      }),
    })
    const startup = gate.inspect()
    await entered.promise
    await gate.acceptAuthorization({
      deviceId: "device-1",
      bindingEpoch: "3",
      sessionCookie: "new-fixture",
    })
    await gate.inspect()
    if (outcome === "timeout")
      old.reject(Object.assign(new Error("unavailable"), { code: "SERVER_UNAVAILABLE" }))
    else old.resolve(view("expired", "2"))
    await startup
    expect(gate.view()).toMatchObject({ state: "active", bindingEpoch: "3", errorCode: null })
    expect(await vault.get("membership:session")).toContain('"bindingEpoch":"3"')
  },
)

it.each(["revoke", "dispose"])("ignores an inspect that completes after %s", async (action) => {
  const vault = new MemoryVault()
  await vault.set("membership:session", JSON.stringify(sessionRecord()))
  const pending = deferred<MembershipView>()
  const entered = deferred<void>()
  const gate = new MembershipGate({
    vault,
    api: api({
      inspectMembership: async () => {
        entered.resolve(undefined)
        return pending.promise
      },
    }),
  })
  const events: MembershipView[] = []
  gate.subscribe((value) => events.push(value))
  const inspection = gate.inspect()
  await entered.promise
  if (action === "revoke") await gate.revoke()
  else gate.dispose()
  const before = gate.view()
  const count = events.length
  pending.resolve(view("active"))
  await inspection
  expect(gate.view()).toEqual(before)
  expect(events).toHaveLength(count)
})
