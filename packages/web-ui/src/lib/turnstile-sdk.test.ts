// 负责验证官方 SDK 的并发加载、失败清理和重试，不访问真实 Cloudflare 网络。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

beforeEach(() => {
  vi.resetModules()
  Reflect.deleteProperty(window, "turnstile")
})
afterEach(() => {
  document.querySelectorAll("script[data-pigclaude-turnstile]").forEach((script) => script.remove())
  Reflect.deleteProperty(window, "turnstile")
  vi.useRealTimers()
})

function installSdk() {
  const sdk = { render: () => "widget", remove: () => undefined }
  Object.assign(window, { turnstile: sdk })
  return sdk
}

describe("Turnstile SDK loader", () => {
  it("shares one explicit official script between concurrent consumers", async () => {
    const { loadTurnstileSdk } = await import("./turnstile-sdk")
    const first = loadTurnstileSdk()
    const second = loadTurnstileSdk()
    expect(first).toBe(second)
    const scripts = document.querySelectorAll<HTMLScriptElement>("script[data-pigclaude-turnstile]")
    expect(scripts).toHaveLength(1)
    expect(scripts[0].src).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    )
    const sdk = installSdk()
    scripts[0].dispatchEvent(new Event("load"))
    await expect(first).resolves.toBe(sdk)
    await expect(second).resolves.toBe(sdk)
    await expect(loadTurnstileSdk()).resolves.toBe(sdk)
    expect(document.querySelectorAll("script[data-pigclaude-turnstile]")).toHaveLength(1)
  })

  it("removes a failed script and permits an actual new load", async () => {
    const { loadTurnstileSdk } = await import("./turnstile-sdk")
    const first = loadTurnstileSdk()
    const rejected = expect(first).rejects.toThrow("验证码组件加载失败")
    const oldScript = document.querySelector("script[data-pigclaude-turnstile]")
    oldScript?.dispatchEvent(new Event("error"))
    await rejected
    expect(oldScript?.isConnected).toBe(false)
    const retried = loadTurnstileSdk()
    const nextScript = document.querySelector("script[data-pigclaude-turnstile]")
    expect(nextScript).not.toBe(oldScript)
    const sdk = installSdk()
    nextScript?.dispatchEvent(new Event("load"))
    await expect(retried).resolves.toBe(sdk)
  })

  it("rejects a loaded script without the SDK and retries after a bounded load timeout", async () => {
    vi.useFakeTimers()
    const { loadTurnstileSdk } = await import("./turnstile-sdk")
    const invalid = loadTurnstileSdk()
    const invalidResult = expect(invalid).rejects.toThrow("验证码组件加载失败")
    document.querySelector("script[data-pigclaude-turnstile]")?.dispatchEvent(new Event("load"))
    await invalidResult
    const retried = loadTurnstileSdk()
    const timeoutResult = expect(retried).rejects.toThrow("验证码组件加载失败")
    await vi.advanceTimersByTimeAsync(15_000)
    await timeoutResult
    expect(document.querySelector("script[data-pigclaude-turnstile]")).toBeNull()
  })
})
