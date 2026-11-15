// 验证会员核验瞬断、恢复和连续失败时，本机 daemon 保留或吊销已有会话令牌且实时拒绝新请求。
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LocalStore } from "@pigclaude/local-store"
import { expect, it, vi } from "vitest"
import { PigclaudeApiError } from "../api/oauth-client"
import { createDesktopComposition } from "../composition"
import { membershipView, profileApi, ProfileVault, seedProfile } from "../testing/profile-fixture"

const minute = 60_000

it("拒绝每个未实时核验的请求，恢复后原令牌继续有效，连续失败十分钟才吊销", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-membership-network-"))
  const vault = new ProfileVault()
  await seedProfile(vault)
  let online = true
  const inspectMembership = vi.fn(async () => {
    if (!online) throw new PigclaudeApiError("SERVER_UNAVAILABLE", null)
    return membershipView()
  })
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  })
  const composition = createDesktopComposition({
    vault,
    api: profileApi({ inspectMembership }),
    authOrigin: "http://127.0.0.1:8788",
    localStore: new LocalStore(directory),
  })
  const runtime = composition.runtime!
  try {
    await composition.resume()
    await runtime.start()
    const baseUrl = runtime.daemonBaseUrl
    expect(baseUrl).not.toBeNull()
    const { token } = runtime.openSession({ sessionId: "grace-session", preferredAccountId: null })
    const request = async (url: string | null) => {
      const response = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: { "x-pigclaude-session": token },
        body: "{}",
      })
      return { status: response.status, body: await response.json() }
    }

    online = false
    const reads = inspectMembership.mock.calls.length
    await expect(request(baseUrl)).resolves.toMatchObject({
      status: 403,
      body: { error: "membership_required" },
    })
    expect(inspectMembership).toHaveBeenCalledTimes(reads + 1)
    expect(composition.membershipGate.view().state).toBe("network_grace")
    expect(runtime.daemonBaseUrl).toBe(baseUrl)

    await vi.advanceTimersByTimeAsync(10 * minute - 1)
    expect(runtime.daemonBaseUrl).toBe(baseUrl)
    online = true
    // 没有本机 Claude 账号。到达选号器已证明原令牌通过了 daemon 门禁。
    await expect(request(baseUrl)).resolves.toMatchObject({
      status: 503,
      body: { error: "no_available_account" },
    })
    expect(composition.membershipGate.view().state).toBe("active")

    online = false
    await composition.resume()
    await vi.advanceTimersByTimeAsync(10 * minute)
    expect(runtime.daemonBaseUrl).toBeNull()
    expect(composition.membershipGate.view().state).toBe("error")
    online = true
    await composition.resume()
    await runtime.start()
    await expect(request(runtime.daemonBaseUrl)).resolves.toMatchObject({
      status: 403,
      body: { error: "invalid_session_token" },
    })
  } finally {
    await composition.dispose()
    vi.useRealTimers()
    await rm(directory, { recursive: true, force: true })
  }
})

it("唤醒后等待联网，心跳和前台检查不提前访问服务端", async () => {
  const vault = new ProfileVault()
  await seedProfile(vault)
  const inspectMembership = vi.fn(async () => membershipView())
  let online = false
  const onOnline = vi.fn()
  vi.useFakeTimers()
  const composition = createDesktopComposition({
    vault,
    api: profileApi({ inspectMembership }),
    authOrigin: "http://127.0.0.1:8788",
  })
  try {
    await composition.resume()
    composition.membershipGate.resumeAfterWake(() => online, onOnline)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await composition.resume()).toMatchObject({ state: "network_grace" })
    await expect(composition.runAuthorized(async () => undefined)).rejects.toThrow(
      "MEMBERSHIP_REQUIRED",
    )
    expect(inspectMembership).toHaveBeenCalledTimes(1)
    expect(onOnline).not.toHaveBeenCalled()

    online = true
    await vi.advanceTimersByTimeAsync(1_000)
    expect(inspectMembership).toHaveBeenCalledTimes(2)
    expect(onOnline).toHaveBeenCalledOnce()
    expect(composition.membershipGate.view().state).toBe("active")
  } finally {
    await composition.dispose()
    vi.useRealTimers()
  }
})

it("前台核验先确认联网时也通知一次，显式关闭不会触发旧的联网回调", async () => {
  const vault = new ProfileVault()
  await seedProfile(vault)
  const inspectMembership = vi.fn(async () => membershipView())
  let online = false
  const onOnline = vi.fn()
  const afterDispose = vi.fn()
  vi.useFakeTimers()
  const composition = createDesktopComposition({
    vault,
    api: profileApi({ inspectMembership }),
    authOrigin: "http://127.0.0.1:8788",
  })
  try {
    await composition.resume()
    composition.membershipGate.resumeAfterWake(() => online, onOnline)
    await vi.advanceTimersByTimeAsync(0)
    expect(onOnline).not.toHaveBeenCalled()

    online = true
    expect(await composition.resume()).toMatchObject({ state: "active" })
    expect(onOnline).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(onOnline).toHaveBeenCalledOnce()

    online = false
    composition.membershipGate.resumeAfterWake(() => online, afterDispose)
    await composition.dispose()
    online = true
    await vi.advanceTimersByTimeAsync(2_000)
    expect(afterDispose).not.toHaveBeenCalled()
  } finally {
    await composition.dispose()
    vi.useRealTimers()
  }
})

it("权益已知到期时不延长宽限，服务端明确撤销时立即撤销已有宽限", async () => {
  const vault = new ProfileVault()
  await seedProfile(vault)
  vi.useFakeTimers()
  const membershipValidUntil = new Date(Date.now() + minute).toISOString()
  let failure: PigclaudeApiError | null = new PigclaudeApiError("SERVER_UNAVAILABLE", null)
  const composition = createDesktopComposition({
    vault,
    api: profileApi({
      inspectMembership: async () => {
        if (failure) throw failure
        return { ...membershipView(), membershipValidUntil }
      },
    }),
    authOrigin: "http://127.0.0.1:8788",
  })
  try {
    expect(await composition.resume()).toMatchObject({ state: "error" })
    failure = null
    expect(await composition.resume()).toMatchObject({ state: "active" })
    failure = new PigclaudeApiError("SERVER_UNAVAILABLE", null)
    expect(await composition.resume()).toMatchObject({ state: "network_grace" })
    await vi.advanceTimersByTimeAsync(minute)
    expect(composition.membershipGate.view().state).toBe("expired")

    failure = null
    vi.setSystemTime(Date.parse(membershipValidUntil) - minute)
    expect(await composition.resume()).toMatchObject({ state: "active" })
    failure = new PigclaudeApiError("SERVER_UNAVAILABLE", null)
    expect(await composition.resume()).toMatchObject({ state: "network_grace" })
    failure = new PigclaudeApiError("DEVICE_REVOKED", 401)
    expect(await composition.resume()).toMatchObject({ state: "device_revoked" })
    expect(await vault.get("membership:session")).toBeNull()
  } finally {
    await composition.dispose()
    vi.useRealTimers()
  }
})
