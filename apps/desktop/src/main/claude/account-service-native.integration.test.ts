// 从授权入口使用真实 native CLI 和本机代理/原始服务，验证附加证据确实进入换取令牌门禁。

import { expect, it } from "vitest"
import { createHarness, fingerprint } from "./account-service-test-fixtures"
import { createLoopbackFixture } from "./fingerprint-chromium-loopback-fixture"
import { NativeEnvironmentInspector } from "./native-environment"
import type { NativeEnvironmentEvidence } from "./environment-check-model"
import { syntheticEnvironmentReport } from "./environment-check-test-fixtures"

it.each([
  { expectedIp: "1.1.1.1", passed: true },
  { expectedIp: "8.8.8.8", passed: false },
])(
  "实际 native 与中转路径核对 $expectedIp，授权结果 $passed",
  async (options) => {
    const fixture = await createLoopbackFixture((_request, response) => response.end("1.1.1.1\n"))
    const diagnostics = new NativeEnvironmentInspector({
      exitTarget: `http://127.0.0.1:${fixture.originPort}/probe`,
    })
    let evidence: NativeEnvironmentEvidence | undefined
    const harness = await createHarness({
      now: Date.now,
      nativeDiagnostics: {
        inspect: async (input) => {
          evidence = await diagnostics.inspect(input)
          return evidence
        },
        dispose: () => diagnostics.dispose(),
      },
      browser: {
        ensureAvailable: async () => "/synthetic/browser",
        profileDir: () => "/synthetic/profile",
        launch: async (input) => {
          input.environmentCheck?.onReport(syntheticEnvironmentReport(input))
          return {
            profileDir: "/synthetic/profile",
            pid: 1,
            exited: new Promise<void>(() => undefined),
            stop: async () => undefined,
          }
        },
        deleteProfile: async () => undefined,
        dispose: async () => undefined,
      },
      egress: { ok: true, ip: options.expectedIp },
    })
    await harness.store.saveProxy({
      schemaVersion: 1,
      id: "p1",
      name: "本机合成代理",
      url: `http://synthetic:password@127.0.0.1:${fixture.proxyPort}`,
      lastTest: null,
    })
    try {
      const operation = harness.service.authorize({
        displayName: "真实 native 合成验收",
        proxyId: "p1",
        fingerprint,
      })
      if (options.passed)
        await expect(operation).resolves.toMatchObject({ displayName: "真实 native 合成验收" })
      else await expect(operation).rejects.toMatchObject({ code: "ENVIRONMENT_CHECK_FAILED" })
      expect(evidence?.checks.find((check) => check.id === "cli-launch")?.state).toBe("passed")
      expect(evidence?.checks.find((check) => check.id === "cli-protocol")?.state).toBe("passed")
      expect(evidence?.checks.find((check) => check.id === "native-routes")?.state).toBe(
        options.passed ? "passed" : "failed",
      )
      expect(evidence?.checks.find((check) => check.id === "cli-intl")?.state).toBe("unknown")
      expect(harness.exchangeRedirectUris).toHaveLength(options.passed ? 1 : 0)
      expect(fixture.requests().direct).toBe(0)
      expect(fixture.requests().viaProxy).toBeGreaterThanOrEqual(2)
    } finally {
      const results = await Promise.allSettled([
        harness.service.dispose(),
        diagnostics.dispose(),
        fixture.close(),
      ])
      await harness.cleanup()
      const rejected = results.filter((result) => result.status === "rejected")
      if (rejected.length)
        throw new AggregateError(
          rejected.map((result) => result.reason),
          "原生集成资源未确认回收",
        )
    }
  },
  45_000,
)

it.each(["cancel", "timeout"] as const)(
  "原生诊断 %s 时不交换凭据，等待所有本轮资源回收",
  async (mode) => {
    let requested: () => void = () => undefined
    const seen = new Promise<void>((resolve) => {
      requested = resolve
    })
    const fixture = await createLoopbackFixture(() => {
      requested()
    })
    const diagnostics = new NativeEnvironmentInspector({
      exitTarget: `http://127.0.0.1:${fixture.originPort}/probe`,
      ...(mode === "timeout" ? { diagnosticTimeoutMs: 300 } : {}),
    })
    const harness = await createHarness({
      now: Date.now,
      nativeDiagnostics: diagnostics,
      egress: { ok: true, ip: "1.1.1.1" },
    })
    await harness.store.saveProxy({
      schemaVersion: 1,
      id: "p1",
      name: "不响应的合成端点",
      url: `http://synthetic:password@127.0.0.1:${fixture.proxyPort}`,
      lastTest: null,
    })
    const operation = harness.service
      .authorize({ displayName: "中止原生诊断", proxyId: "p1", fingerprint })
      .catch((error: unknown) => error)
    try {
      if (mode === "cancel") {
        await seen
        await harness.service.cancel()
      }
      await expect(operation).resolves.toMatchObject({
        code: mode === "cancel" ? "AUTHORIZATION_CANCELLED" : "ENVIRONMENT_CHECK_FAILED",
      })
      expect(harness.exchangeRedirectUris).toEqual([])
      expect(await harness.service.list()).toEqual([])
      await diagnostics.settle()
    } finally {
      await harness.service.cancel()
      await operation
      const results = await Promise.allSettled([
        harness.service.dispose(),
        diagnostics.dispose(),
        fixture.close(),
      ])
      await harness.cleanup()
      const rejected = results.filter((result) => result.status === "rejected")
      if (rejected.length)
        throw new AggregateError(
          rejected.map((result) => result.reason),
          "中止后资源未确认回收",
        )
    }
  },
  15_000,
)
