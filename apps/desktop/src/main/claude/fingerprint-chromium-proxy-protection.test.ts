// 验证未证明代理强制能力的内核不能启动绑定代理授权。

import { EventEmitter } from "node:events"
import type { ChildProcess, spawn } from "node:child_process"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { createHarness, seedAccount } from "./account-service-test-fixtures"
import { ClaudeAccountError } from "./errors"
import { FingerprintChromiumAdapter } from "./fingerprint-chromium"

const roots: string[] = []
const fingerprint: ClaudeFingerprintView = {
  seed: "42",
  brand: "Chrome",
  platform: "macos",
  lang: "en-US",
  timezone: "UTC",
  canvasNoise: "",
  clientRectsNoise: "",
  unknownArgs: ["--load-extension=/synthetic/extension"],
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it("blocks a bound launch with an unverified kernel before spawning or creating a profile", async () => {
  const { adapter, root, calls } = await createAdapter()
  await expect(
    adapter.launch({
      accountId: "fixture",
      authorizeUrl: "https://example.test/authorize",
      network: {
        mode: "bound",
        bridgeUrl: "http://127.0.0.1:9000",
        callbackUri: "http://localhost:1234/callback",
      },
      fingerprint,
    }),
  ).rejects.toMatchObject({
    code: "BROWSER_START_FAILED",
    message: expect.stringContaining("受管代理保护"),
  })
  expect(calls).toEqual([])
  await expect(stat(join(root, "fixture"))).rejects.toMatchObject({ code: "ENOENT" })
})

it("blocks a bound account before bridge and callback without changing its saved settings", async () => {
  const { adapter, root, calls } = await createAdapter()
  const harness = await createHarness({ browser: adapter })
  const existing = { ...seedAccount(), fingerprint }
  await harness.store.saveAccount(existing)
  const before = await harness.store.getAccount(existing.id)
  await expect(
    harness.service.authorize({
      accountId: existing.id,
      displayName: existing.displayName,
      proxyId: existing.proxyId,
      fingerprint,
    }),
  ).rejects.toMatchObject({
    code: "BROWSER_START_FAILED",
    message: expect.stringContaining("受管代理保护"),
  })
  expect(harness.bridgeCalls).toEqual([])
  expect(harness.egressCalls).toEqual([])
  expect(harness.callbackCalls).toEqual([])
  expect(calls).toEqual([])
  expect(await harness.store.getAccount(existing.id)).toEqual(before)
  await expect(stat(join(root, existing.id))).rejects.toMatchObject({ code: "ENOENT" })
})

it("keeps extension loading available for an explicitly unbound account", async () => {
  const { adapter, calls } = await createAdapter()
  const harness = await createHarness({ browser: adapter })
  const account = await harness.service.authorize({
    displayName: "系统网络",
    proxyId: null,
    fingerprint,
  })
  expect(account.proxyId).toBeNull()
  expect(account.fingerprint.unknownArgs).toEqual(fingerprint.unknownArgs)
  expect(calls[0]).toContain("--load-extension=/synthetic/extension")
  expect(calls[0]?.some((arg) => arg.startsWith("--proxy-server"))).toBe(false)
  expect(harness.bridgeCalls).toEqual([])
})

it("does not trust an environment override but keeps it usable on system networking", async () => {
  const { adapter, calls } = await createAdapter(true)
  const input = {
    accountId: "fixture",
    authorizeUrl: "https://example.test/authorize",
    fingerprint,
  }
  await expect(
    adapter.launch({
      ...input,
      network: {
        mode: "bound",
        bridgeUrl: "http://127.0.0.1:9000",
        callbackUri: "http://localhost:1234/callback",
      },
    }),
  ).rejects.toMatchObject({ message: expect.stringContaining("受管代理保护") })
  expect(calls).toEqual([])
  await adapter.launch({ ...input, network: { mode: "system" } })
  expect(calls[0]).toContain("--load-extension=/synthetic/extension")
})

it("keeps an existing system-network authorization cancellable after a bound attempt is blocked", async () => {
  const { adapter, calls } = await createAdapter()
  let rejectWait: ((error: Error) => void) | undefined
  let notifyWaiting: () => void = () => undefined
  const waiting = new Promise<void>((resolve) => {
    notifyWaiting = resolve
  })
  const callback = {
    redirectUri: "http://localhost:1234/callback",
    waitForCode: () => {
      notifyWaiting()
      return new Promise<string>((_resolve, reject) => {
        rejectWait = reject
      })
    },
    close: async () => {
      rejectWait?.(new ClaudeAccountError("AUTHORIZATION_CANCELLED", "取消"))
    },
  }
  const harness = await createHarness({ browser: adapter, callback })
  const existing = harness.service.authorize({
    displayName: "系统网络",
    proxyId: null,
    fingerprint,
  })
  const outcome = expect(existing).rejects.toMatchObject({ code: "AUTHORIZATION_CANCELLED" })
  await waiting
  await expect(
    harness.service.authorize({ displayName: "绑定代理", proxyId: "p1", fingerprint }),
  ).rejects.toMatchObject({ message: expect.stringContaining("受管代理保护") })
  expect(calls).toHaveLength(1)
  await harness.service.cancel()
  await outcome
})

async function createAdapter(useEnvironment = false) {
  const root = await mkdtemp(join(tmpdir(), "proxy-protection-"))
  roots.push(root)
  const calls: string[][] = []
  const fakeSpawn = ((_binary: string, args: string[]): ChildProcess => {
    calls.push(args)
    const child = Object.assign(new EventEmitter(), {
      pid: 1234,
      unref: () => undefined,
      kill: (signal: NodeJS.Signals) => {
        queueMicrotask(() => child.emit("exit", 0, signal))
        return true
      },
    })
    queueMicrotask(() => child.emit("spawn"))
    return child as unknown as ChildProcess
  }) as typeof spawn
  return {
    adapter: new FingerprintChromiumAdapter({
      ...(useEnvironment
        ? { env: { PIGCLAUDE_FINGERPRINT_CHROMIUM_BIN: process.execPath } }
        : { binaryPath: process.execPath }),
      profilesRoot: root,
      spawn: fakeSpawn,
    }),
    root,
    calls,
  }
}
