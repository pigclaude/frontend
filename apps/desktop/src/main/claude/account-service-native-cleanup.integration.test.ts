// 从授权入口向真实服务器边界注入准备/清理故障，验证未确认资源会阻止下一轮诊断。

import { Server } from "node:net"
import { expect, it, vi } from "vitest"
import { createHarness, fingerprint } from "./account-service-test-fixtures"
import { createLoopbackFixture } from "./fingerprint-chromium-loopback-fixture"
import { NativeEnvironmentInspector } from "./native-environment"

it("协议服务准备失败且清理未确认时，保留句柄并阻止新授权诊断", async () => {
  const fixture = await createLoopbackFixture((_request, response) => response.end("1.1.1.1\n"))
  const diagnostics = new NativeEnvironmentInspector({
    exitTarget: `http://127.0.0.1:${fixture.originPort}/probe`,
  })
  const harness = await createHarness({
    now: Date.now,
    nativeDiagnostics: diagnostics,
    egress: { ok: true, ip: "1.1.1.1" },
  })
  await harness.store.saveProxy({
    schemaVersion: 1,
    id: "p1",
    name: "本机合成代理",
    url: `http://synthetic:password@127.0.0.1:${fixture.proxyPort}`,
    lastTest: null,
  })
  const originalListen = Server.prototype.listen
  const originalClose = Server.prototype.close
  let attempts = 0
  const resources: { retained?: Server } = {}
  let release = false
  const listening = vi.spyOn(Server.prototype, "listen").mockImplementation(function (
    this: Server,
    ...args: Parameters<Server["listen"]>
  ) {
    attempts++
    if (attempts === 2) resources.retained = this
    if (attempts === 3) {
      queueMicrotask(() => this.emit("error", new Error("合成监听准备故障")))
      return this
    }
    return Reflect.apply(originalListen, this, args) as Server
  })
  const closing = vi.spyOn(Server.prototype, "close").mockImplementation(function (
    this: Server,
    callback?: (error?: Error) => void,
  ) {
    if (this === resources.retained && !release) {
      queueMicrotask(() => callback?.(new Error("合成清理未确认")))
      return this
    }
    return Reflect.apply(originalClose, this, [callback]) as Server
  })
  const authorize = () =>
    harness.service.authorize({ displayName: "清理所有权验收", proxyId: "p1", fingerprint })
  try {
    await expect(authorize()).rejects.toThrow()
    expect(resources.retained?.listening).toBe(true)
    const failedAttempts = attempts
    await expect(authorize()).rejects.toThrow()
    expect(attempts).toBe(failedAttempts)
    expect(harness.exchangeRedirectUris).toEqual([])
    release = true
    await diagnostics.settle()
    await harness.service.cancel()
    expect(resources.retained?.listening).toBe(false)
    await expect(authorize()).resolves.toMatchObject({ displayName: "清理所有权验收" })
    expect(attempts).toBeGreaterThan(failedAttempts)
  } finally {
    release = true
    const results = await Promise.allSettled([harness.service.dispose(), diagnostics.dispose()])
    listening.mockRestore()
    closing.mockRestore()
    if (resources.retained?.listening)
      await new Promise<void>((resolve, reject) =>
        resources.retained?.close((error) => (error ? reject(error) : resolve())),
      )
    await fixture.close()
    await harness.cleanup()
    if (results.some((result) => result.status === "rejected"))
      throw new Error("清理故障用例仍持有本机资源")
  }
}, 20_000)
