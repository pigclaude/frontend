// fingerprint-chromium 启动器测试。覆盖参数、profile 目录、进程停止和错误映射。

import { EventEmitter } from "node:events"
import type { ChildProcess } from "node:child_process"
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BrowserLaunchError, FingerprintChromiumAdapter } from "./fingerprint-chromium"

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const fingerprint = {
  seed: "123456",
  brand: "Chrome",
  platform: "macos",
  lang: "en-US",
  timezone: "America/Los_Angeles",
  canvasNoise: true,
  clientRectsNoise: false,
}

describe("FingerprintChromiumAdapter", () => {
  it("requires an explicit fingerprint-chromium binary", async () => {
    const root = await tempRoot()
    const adapter = new FingerprintChromiumAdapter({
      binaryPath: "/definitely/not/fingerprint-chromium",
      profilesRoot: root,
    })
    await expect(adapter.ensureAvailable()).rejects.toMatchObject({
      code: "BROWSER_MISSING",
    })
  })

  it("launches the kernel with profile, proxy, fingerprint and URL", async () => {
    const binary = await fakeBinary()
    const root = await tempRoot()
    const calls: Array<{ binary: string; args: string[] }> = []
    const child = new FakeChild()
    const adapter = new FingerprintChromiumAdapter({
      binaryPath: binary,
      profilesRoot: root,
      spawn: fakeSpawn((command, args) => {
        calls.push({ binary: command, args })
        return child
      }),
    })
    const launched = await adapter.launch({
      accountId: "acc-1",
      authorizeUrl: "https://claude.test/authorize",
      bridgeUrl: "http://127.0.0.1:9000",
      fingerprint,
    })
    expect(launched).toMatchObject({ pid: 4321 })
    expect(launched.profileDir).toBe(join(root, "acc-1"))
    expect((await stat(launched.profileDir)).isDirectory()).toBe(true)
    const args = calls[0]?.args ?? []
    expect(calls[0]?.binary).toBe(binary)
    expect(args).toContain(`--user-data-dir=${join(root, "acc-1")}`)
    expect(args).toContain("--proxy-server=http://127.0.0.1:9000")
    expect(args).toContain("--proxy-bypass-list=localhost;127.0.0.1")
    expect(args).toContain("--fingerprint=123456")
    expect(args).toContain("--fingerprint-brand=Chrome")
    expect(args).toContain("--fingerprint-platform=macos")
    expect(args).toContain("--lang=en-US")
    expect(args).toContain("--accept-lang=en-US,en")
    expect(args).toContain("--timezone=America/Los_Angeles")
    expect(args).toContain("--disable-spoofing=clientrects")
    expect(args.at(-1)).toBe("https://claude.test/authorize")
  })

  it("stops the previous process before launching the same account again", async () => {
    const binary = await fakeBinary()
    const root = await tempRoot()
    const children: FakeChild[] = []
    const adapter = new FingerprintChromiumAdapter({
      binaryPath: binary,
      profilesRoot: root,
      spawn: fakeSpawn(() => {
        const child = new FakeChild()
        children.push(child)
        return child
      }),
    })
    await adapter.launch({
      accountId: "acc-1",
      authorizeUrl: "https://claude.test/1",
      bridgeUrl: "http://127.0.0.1:9000",
      fingerprint,
    })
    await adapter.launch({
      accountId: "acc-1",
      authorizeUrl: "https://claude.test/2",
      bridgeUrl: "http://127.0.0.1:9000",
      fingerprint,
    })
    expect(children[0]?.signals).toEqual(["SIGTERM"])
    expect(children[1]?.signals).toEqual([])
  })

  it("deletes only the account profile directory", async () => {
    const binary = await fakeBinary()
    const root = await tempRoot()
    const adapter = new FingerprintChromiumAdapter({
      binaryPath: binary,
      profilesRoot: root,
      spawn: fakeSpawn(() => new FakeChild()),
    })
    const launched = await adapter.launch({
      accountId: "acc-1",
      authorizeUrl: "https://claude.test/authorize",
      bridgeUrl: "http://127.0.0.1:9000",
      fingerprint,
    })
    await writeFile(join(launched.profileDir, "marker"), "x")
    await adapter.deleteProfile("acc-1")
    await expect(stat(launched.profileDir)).rejects.toBeTruthy()
  })

  it("escalates to SIGKILL when the process ignores SIGTERM", async () => {
    const binary = await fakeBinary()
    const root = await tempRoot()
    const child = new FakeChild()
    child.exitOnTerminate = false
    const adapter = new FingerprintChromiumAdapter({
      binaryPath: binary,
      profilesRoot: root,
      spawn: fakeSpawn(() => child),
      stopTimeoutMs: 10,
    })
    await adapter.launch({
      accountId: "acc-1",
      authorizeUrl: "https://claude.test/authorize",
      bridgeUrl: "http://127.0.0.1:9000",
      fingerprint,
    })
    child.exitOnKill = true
    await adapter.stop("acc-1")
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"])
  })

  it("maps a spawn failure to BROWSER_START_FAILED", async () => {
    const binary = await fakeBinary()
    const root = await tempRoot()
    const adapter = new FingerprintChromiumAdapter({
      binaryPath: binary,
      profilesRoot: root,
      spawn: fakeSpawn(() => {
        const child = new FakeChild()
        child.failSpawn = true
        return child
      }),
    })
    await expect(
      adapter.launch({
        accountId: "acc-1",
        authorizeUrl: "https://claude.test/authorize",
        bridgeUrl: "http://127.0.0.1:9000",
        fingerprint,
      }),
    ).rejects.toBeInstanceOf(BrowserLaunchError)
  })

  it("rejects account IDs that could escape the profile root", async () => {
    const root = await tempRoot()
    const adapter = new FingerprintChromiumAdapter({
      binaryPath: "/tmp/chromium",
      profilesRoot: root,
    })
    expect(() => adapter.profileDir("../escape")).toThrow(BrowserLaunchError)
  })

  it("reads the binary from the environment when no path is configured", async () => {
    const binary = await fakeBinary()
    const root = await tempRoot()
    const adapter = new FingerprintChromiumAdapter({
      profilesRoot: root,
      env: { PIGCLAUDE_FINGERPRINT_CHROMIUM_BIN: binary },
    })
    await expect(adapter.ensureAvailable()).resolves.toBe(binary)
  })
})

class FakeChild extends EventEmitter {
  pid = 4321
  signals: string[] = []
  exitOnTerminate = true
  exitOnKill = false
  failSpawn = false
  unref = vi.fn()

  kill(signal?: NodeJS.Signals): boolean {
    const next = signal ?? "SIGTERM"
    this.signals.push(next)
    if (next === "SIGKILL" && this.exitOnKill) this.emit("exit", 0, next)
    else if (next === "SIGTERM" && this.exitOnTerminate) this.emit("exit", 0, next)
    return true
  }
}

function fakeSpawn(
  handler: (binary: string, args: string[]) => FakeChild,
): typeof import("node:child_process").spawn {
  const spawn = (binary: string, args: string[]): ChildProcess => {
    const child = handler(binary, args)
    queueMicrotask(() => {
      if (child.failSpawn) child.emit("error", new Error("spawn failed"))
      else child.emit("spawn")
    })
    return child as unknown as ChildProcess
  }
  return spawn as typeof import("node:child_process").spawn
}

async function fakeBinary(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kernel-"))
  cleanups.push(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  const binary = join(dir, "Chromium")
  await writeFile(binary, "#!/bin/sh\nexit 0\n")
  await chmod(binary, 0o755)
  return binary
}

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "profiles-"))
  cleanups.push(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}
