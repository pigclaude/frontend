// fingerprint-chromium 启动器测试。覆盖参数、profile 目录、进程停止和错误映射。

import { EventEmitter } from "node:events"
import type { ChildProcess } from "node:child_process"
import { copyFile, link, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { BrowserLaunchError } from "./fingerprint-chromium"
import { createSyntheticBrowserAdapter } from "./browser-startup-test-utils"

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const fingerprint: ClaudeFingerprintView = {
  seed: "123456",
  brand: "Chrome",
  platform: "macos",
  lang: "en-US",
  timezone: "America/Los_Angeles",
  canvasNoise: "1",
  clientRectsNoise: "0",
  resolution: "1920,1080",
  hardwareConcurrency: "8",
  webrtcPolicy: "disable_non_proxied_udp",
  disableSpoofing: ["font"],
}

describe("FingerprintChromiumAdapter", () => {
  it("requires an explicit fingerprint-chromium binary", async () => {
    const root = await tempRoot()
    const adapter = createSyntheticBrowserAdapter({
      hostArch: process.arch,
      binaryPath: "/definitely/not/fingerprint-chromium",
      profilesRoot: root,
    })
    await expect(adapter.ensureAvailable()).rejects.toMatchObject({
      code: "BROWSER_MISSING",
    })
  })

  it("launches the kernel with the profile and fingerprint on system networking", async () => {
    const binary = await fakeBinary()
    const root = await tempRoot()
    const calls: Array<{ binary: string; args: string[] }> = []
    const child = new FakeChild()
    const adapter = createSyntheticBrowserAdapter({
      hostArch: process.arch,
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
      network: { mode: "system" },
      fingerprint,
    })
    expect(launched).toMatchObject({ pid: 4321 })
    expect(launched.profileDir).toBe(join(root, "acc-1"))
    expect((await stat(launched.profileDir)).isDirectory()).toBe(true)
    expect(calls[0]?.binary).toBe(binary)
    expect(calls[0]?.args).toEqual([
      `--user-data-dir=${join(root, "acc-1")}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--remote-debugging-pipe",
      "--no-startup-window",
      "--fingerprint=123456",
      "--fingerprint-brand=Chrome",
      "--fingerprint-platform=macos",
      "--lang=en-US",
      "--accept-lang=en-US,en",
      "--timezone=America/Los_Angeles",
      "--window-size=1920,1080",
      "--fingerprint-hardware-concurrency=8",
      "--disable-non-proxied-udp",
      "--fingerprinting-canvas-image-data-noise",
      "--fingerprinting-client-rects-noise=0",
      "--disable-spoofing=font",
    ])
  })

  it("computes the default window size from the injected host screen", async () => {
    const binary = await fakeBinary()
    const root = await tempRoot()
    const calls: string[][] = []
    const adapter = createSyntheticBrowserAdapter({
      hostArch: process.arch,
      binaryPath: binary,
      profilesRoot: root,
      screenSize: { width: 2560, height: 1440 },
      spawn: fakeSpawn((_command, args) => {
        calls.push(args)
        return new FakeChild()
      }),
    })
    await adapter.launch({
      accountId: "acc-1",
      authorizeUrl: "https://claude.test/authorize",
      network: { mode: "system" as const },
      fingerprint: { ...fingerprint, resolution: "" },
    })
    expect(calls[0]).toContain("--window-size=1075,605")
  })

  it("generates a stable seed from the account id when none is stored", async () => {
    const binary = await fakeBinary()
    const root = await tempRoot()
    const calls: string[][] = []
    const adapter = createSyntheticBrowserAdapter({
      hostArch: process.arch,
      binaryPath: binary,
      profilesRoot: root,
      spawn: fakeSpawn((_command, args) => {
        calls.push(args)
        return new FakeChild()
      }),
    })
    const emptySeed = { ...fingerprint, seed: "" }
    await adapter.launch({
      accountId: "acc-1",
      authorizeUrl: "https://claude.test/1",
      network: { mode: "system" as const },
      fingerprint: emptySeed,
    })
    await adapter.launch({
      accountId: "acc-1",
      authorizeUrl: "https://claude.test/2",
      network: { mode: "system" as const },
      fingerprint: emptySeed,
    })
    await adapter.launch({
      accountId: "acc-2",
      authorizeUrl: "https://claude.test/3",
      network: { mode: "system" as const },
      fingerprint: emptySeed,
    })
    const seeds = calls.map((args) => args.find((arg) => arg.startsWith("--fingerprint=")))
    expect(seeds[0]).toMatch(/^--fingerprint=\d+$/)
    expect(seeds[1]).toBe(seeds[0])
    expect(seeds[2]).not.toBe(seeds[0])
  })

  it("rejects an invalid fingerprint before spawning", async () => {
    const binary = await fakeBinary()
    const root = await tempRoot()
    let spawnCount = 0
    const adapter = createSyntheticBrowserAdapter({
      hostArch: process.arch,
      binaryPath: binary,
      profilesRoot: root,
      spawn: fakeSpawn(() => {
        spawnCount += 1
        return new FakeChild()
      }),
    })
    await expect(
      adapter.launch({
        accountId: "acc-1",
        authorizeUrl: "https://claude.test/authorize",
        network: { mode: "system" as const },
        fingerprint: { ...fingerprint, hardwareConcurrency: "999" },
      }),
    ).rejects.toMatchObject({
      code: "BROWSER_START_FAILED",
      message: "CPU 核心数必须是 1 到 128 的整数",
    })
    expect(spawnCount).toBe(0)
  })

  it("rejects a profile-directory conflict without stopping an existing browser", async () => {
    const binary = await fakeBinary()
    const root = await tempRoot()
    const child = new FakeChild()
    const calls: string[][] = []
    const spawn = fakeSpawn((_command, args) => {
      calls.push(args)
      return child
    })
    const adapter = createSyntheticBrowserAdapter({
      hostArch: process.arch,
      binaryPath: binary,
      profilesRoot: root,
      spawn,
    })
    const input = {
      accountId: "acc-1",
      authorizeUrl: "https://claude.test/authorize",
      network: { mode: "system" as const },
      fingerprint,
    }
    await adapter.launch(input)
    await expect(
      adapter.launch({
        ...input,
        fingerprint: { ...fingerprint, unknownArgs: ["--profile-directory=.."] },
      }),
    ).rejects.toMatchObject({
      code: "BROWSER_START_FAILED",
      message: expect.stringContaining("--profile-directory"),
    })
    expect(calls).toHaveLength(1)
    expect(child.signals).toEqual([])
  })

  it.each([
    "user-data-dir",
    "profile-directory",
    "proxy-server",
    "proxy-bypass-list",
    "no-proxy-server",
    "proxy-pac-url",
    "proxy-auto-detect",
    "remote-debugging-pipe",
    "no-startup-window",
    "ignore-certificate-errors",
    "ignore-certificate-errors-spki-list",
    "allow-insecure-localhost",
    "disable-web-security",
    "allow-running-insecure-content",
  ])("rejects the managed %s key in either network mode", async (key) => {
    const binary = await fakeBinary()
    const root = await tempRoot()
    const calls: string[][] = []
    const spawn = fakeSpawn((_command, args) => {
      calls.push(args)
      return new FakeChild()
    })
    const adapter = createSyntheticBrowserAdapter({
      hostArch: process.arch,
      binaryPath: binary,
      profilesRoot: root,
      spawn,
    })
    for (const bridgeUrl of [undefined, "socks5://127.0.0.1:9000"]) {
      await expect(
        adapter.launch({
          accountId: "acc-1",
          authorizeUrl: "https://claude.test/authorize",
          network:
            bridgeUrl === undefined
              ? { mode: "system" }
              : { mode: "bound", bridgeUrl, callbackUri: "http://localhost:1234/callback" },
          fingerprint: { ...fingerprint, unknownArgs: [`--${key}=private-value`] },
        }),
      ).rejects.toMatchObject({
        code: "BROWSER_START_FAILED",
        message: expect.stringContaining(`--${key}`),
      })
    }
    expect(calls).toEqual([])
    await expect(stat(join(root, "acc-1"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it.each(["host-resolver-rules", "host-rules", "use-system-proxy-resolver"])(
    "rejects %s only when a proxy is bound",
    async (key) => {
      const binary = await fakeBinary()
      const root = await tempRoot()
      const args = [`--${key}=example`]
      const calls: string[][] = []
      const adapter = createSyntheticBrowserAdapter({
        hostArch: process.arch,
        binaryPath: binary,
        profilesRoot: root,
        spawn: fakeSpawn((_command, values) => {
          calls.push(values)
          return new FakeChild()
        }),
      })
      const input = {
        accountId: "acc-1",
        authorizeUrl: "https://claude.test/authorize",
        network: { mode: "system" as const },
        fingerprint: { ...fingerprint, unknownArgs: args },
      }
      await expect(
        adapter.launch({
          ...input,
          network: {
            mode: "bound",
            bridgeUrl: "socks5://127.0.0.1:9000",
            callbackUri: "http://localhost:1234/callback",
          },
        }),
      ).rejects.toMatchObject({
        code: "BROWSER_START_FAILED",
        message: expect.stringContaining(`--${key}`),
      })
      await adapter.launch(input)
      expect(calls[0]).toContain(args[0])
    },
  )

  it("launches without proxy arguments when no bridge is given", async () => {
    const binary = await fakeBinary()
    const root = await tempRoot()
    const calls: string[][] = []
    const adapter = createSyntheticBrowserAdapter({
      hostArch: process.arch,
      binaryPath: binary,
      profilesRoot: root,
      spawn: fakeSpawn((_command, args) => {
        calls.push(args)
        return new FakeChild()
      }),
    })
    await adapter.launch({
      accountId: "acc-1",
      authorizeUrl: "https://claude.test/authorize",
      network: { mode: "system" as const },
      fingerprint,
    })
    const args = calls[0] ?? []
    expect(args.some((arg) => arg.startsWith("--proxy-server"))).toBe(false)
    expect(args).not.toContain("--proxy-bypass-list=localhost;127.0.0.1")
    expect(args).toContain(`--user-data-dir=${join(root, "acc-1")}`)
    expect(args).not.toContain("https://claude.test/authorize")
    expect(args).toContain("--remote-debugging-pipe")
    expect(args).toContain("--no-startup-window")
  })

  it("stops the previous process before launching the same account again", async () => {
    const binary = await fakeBinary()
    const root = await tempRoot()
    const children: FakeChild[] = []
    const adapter = createSyntheticBrowserAdapter({
      hostArch: process.arch,
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
      network: { mode: "system" },
      fingerprint,
    })
    await adapter.launch({
      accountId: "acc-1",
      authorizeUrl: "https://claude.test/2",
      network: { mode: "system" },
      fingerprint,
    })
    expect(children[0]?.signals).toEqual(["SIGTERM"])
    expect(children[1]?.signals).toEqual([])
  })

  it("deletes only the account profile directory", async () => {
    const binary = await fakeBinary()
    const root = await tempRoot()
    const adapter = createSyntheticBrowserAdapter({
      hostArch: process.arch,
      binaryPath: binary,
      profilesRoot: root,
      spawn: fakeSpawn(() => new FakeChild()),
    })
    const launched = await adapter.launch({
      accountId: "acc-1",
      authorizeUrl: "https://claude.test/authorize",
      network: { mode: "system" },
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
    const adapter = createSyntheticBrowserAdapter({
      hostArch: process.arch,
      binaryPath: binary,
      profilesRoot: root,
      spawn: fakeSpawn(() => child),
      stopTimeoutMs: 10,
    })
    await adapter.launch({
      accountId: "acc-1",
      authorizeUrl: "https://claude.test/authorize",
      network: { mode: "system" },
      fingerprint,
    })
    child.exitOnKill = true
    await adapter.stop("acc-1")
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"])
  })

  it("maps a spawn failure to BROWSER_START_FAILED", async () => {
    const binary = await fakeBinary()
    const root = await tempRoot()
    const adapter = createSyntheticBrowserAdapter({
      hostArch: process.arch,
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
        network: { mode: "system" },
        fingerprint,
      }),
    ).rejects.toBeInstanceOf(BrowserLaunchError)
  })

  it("rejects account IDs that could escape the profile root", async () => {
    const root = await tempRoot()
    const adapter = createSyntheticBrowserAdapter({
      hostArch: process.arch,
      binaryPath: "/tmp/chromium",
      profilesRoot: root,
    })
    expect(() => adapter.profileDir("../escape")).toThrow(BrowserLaunchError)
  })

  it("reads the binary from the environment when no path is configured", async () => {
    const binary = await fakeBinary()
    const root = await tempRoot()
    const adapter = createSyntheticBrowserAdapter({
      hostArch: process.arch,
      profilesRoot: root,
      env: { PIGCLAUDE_PIGBROWSER_BIN: binary },
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
  await link(process.execPath, binary).catch(() => copyFile(process.execPath, binary))
  return binary
}

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "profiles-"))
  cleanups.push(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}
