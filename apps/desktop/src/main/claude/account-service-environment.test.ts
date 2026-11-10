// 从账号授权入口验证本轮自检证据缺失时不能换取或保存 Claude 凭据。

import { expect, it } from "vitest"
import { createHarness, fingerprint } from "./account-service-test-fixtures"
import { syntheticEnvironmentReport } from "./environment-check-test-fixtures"
import type { EnvironmentCheckReport } from "./environment-check-model"
import type { LaunchBrowserInput } from "./fingerprint-chromium"

it("没有本轮自检报告的提前回调不能完成授权", async () => {
  const harness = await createHarness({
    browser: {
      ensureAvailable: async () => "/synthetic/browser",
      profileDir: () => "/synthetic/profile",
      launch: async () => ({
        profileDir: "/synthetic/profile",
        pid: 1,
        exited: new Promise<void>(() => undefined),
        stop: async () => undefined,
      }),
      deleteProfile: async () => undefined,
      dispose: async () => undefined,
    },
  })
  try {
    await expect(
      harness.service.authorize({ displayName: "合成验收账号", proxyId: "p1", fingerprint }),
    ).rejects.toMatchObject({ code: "ENVIRONMENT_CHECK_FAILED" })
    expect(harness.exchangeRedirectUris).toEqual([])
    expect(await harness.service.list()).toEqual([])
  } finally {
    await harness.service.dispose()
    await harness.cleanup()
  }
})

it("本轮完整通过的自检允许继续用户授权", async () => {
  const harness = await createHarness()
  try {
    await expect(
      harness.service.authorize({ displayName: "已自检账号", proxyId: "p1", fingerprint }),
    ).resolves.toMatchObject({ displayName: "已自检账号" })
    expect(harness.exchangeRedirectUris).toHaveLength(1)
  } finally {
    await harness.service.dispose()
    await harness.cleanup()
  }
})

it.each([
  "missing",
  "duplicate",
  "unknown",
  "failed",
  "old-run",
  "wrong-binding",
  "old-native-scope",
  "native-result-overwrite",
  "native-snapshot-overwrite",
  "native-item-missing",
  "different-config",
  "old-time",
  "forged-critical",
] as const)("自报通过但证据为 %s 时不能换取令牌", async (kind) => {
  const harness = await reportHarness((report, input) => {
    const first = report.checks[0]
    if (!first) throw new Error("合成必需项目缺失")
    if (kind === "missing") report.checks.shift()
    if (kind === "duplicate") report.checks.push({ ...first })
    if (kind === "unknown") first.state = "unknown"
    if (kind === "failed") first.state = "failed"
    if (kind === "old-run") report.runId = "previous-authorization"
    if (kind === "wrong-binding") report.binding = "different-environment"
    if (kind === "old-native-scope")
      Object.assign(report, { policy: "pigclaude-auth-environment/1" })
    if (kind === "native-result-overwrite") {
      const native = report.checks.find((check) => check.id === "cli-protocol")
      if (!native) throw new Error("合成原生结果缺失")
      native.actual = "未经主进程采样的替换结果"
    }
    if (kind === "native-snapshot-overwrite") {
      const exposed = input.environmentCheck?.nativeEvidence?.checks.find(
        (check) => check.id === "cli-protocol",
      )
      const reported = report.checks.find((check) => check.id === "cli-protocol")
      if (!exposed || !reported) throw new Error("合成原生快照缺失")
      exposed.actual = reported.actual = "同时篡改已暴露的快照与报告"
    }
    if (kind === "native-item-missing")
      report.checks = report.checks.filter((check) => check.id !== "native-routes")
    if (kind === "different-config")
      return syntheticEnvironmentReport({
        ...input,
        fingerprint: { ...input.fingerprint, lang: "fr-FR" },
      })
    if (kind === "old-time") report.createdAt -= 1
    if (kind === "forged-critical") first.critical = false
    return report
  })
  try {
    await expect(
      harness.service.authorize({ displayName: "合成账号", proxyId: "p1", fingerprint }),
    ).rejects.toMatchObject({ code: "ENVIRONMENT_CHECK_FAILED" })
    expect(harness.exchangeRedirectUris).toEqual([])
    expect(await harness.service.list()).toEqual([])
  } finally {
    await harness.service.dispose()
    await harness.cleanup()
  }
})

it("报告提交时通过但换取令牌前已过期，仍拒绝该回调", async () => {
  let now = Date.parse("2026-10-21T00:00:00.000Z")
  const harness = await reportHarness((report) => report, {
    now: () => now,
    afterReport: () => {
      now += 10 * 60 * 1_000
    },
  })
  try {
    await expect(
      harness.service.authorize({ displayName: "过期报告", proxyId: "p1", fingerprint }),
    ).rejects.toMatchObject({ code: "ENVIRONMENT_CHECK_FAILED" })
    expect(harness.exchangeRedirectUris).toEqual([])
    expect(await harness.service.list()).toEqual([])
  } finally {
    await harness.service.dispose()
    await harness.cleanup()
  }
})

async function reportHarness(
  edit: (report: EnvironmentCheckReport, input: LaunchBrowserInput) => EnvironmentCheckReport,
  options: { now?: () => number; afterReport?: () => void } = {},
) {
  return createHarness({
    now: options.now,
    browser: {
      ensureAvailable: async () => "/synthetic/browser",
      profileDir: () => "/synthetic/profile",
      launch: async (input: LaunchBrowserInput) => {
        input.environmentCheck?.onReport(edit(syntheticEnvironmentReport(input), input))
        options.afterReport?.()
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
  })
}
