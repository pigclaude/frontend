// 验证浏览器启动器按真实宿主识别受管参数，并保留其他原始参数。

import { EventEmitter } from "node:events"
import type { ChildProcess, spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import {
  FingerprintChromiumAdapter,
  type LaunchBrowserInput,
  type LaunchBrowserNetwork,
} from "./fingerprint-chromium"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const fingerprint: ClaudeFingerprintView = {
  seed: "42",
  brand: "Chrome",
  platform: "windows",
  lang: "en-US",
  timezone: "UTC",
  canvasNoise: "",
  clientRectsNoise: "",
}

describe("受管浏览器启动参数", () => {
  it.each([
    { host: "darwin", raw: "  -profile-directory=..\t", key: "profile-directory" },
    { host: "linux", raw: "\n--proxy-server=private\r", key: "proxy-server" },
    { host: "win32", raw: "\u0085/UsEr-DaTa-DiR=private\u0085", key: "user-data-dir" },
    { host: "win32", raw: " /PROXY-PAC-URL=private ", key: "proxy-pac-url" },
  ] as const)("rejects $raw on $host without exposing its value", async ({ host, raw, key }) => {
    const { adapter, calls } = await createAdapter(host)
    const pending = adapter.launch({
      accountId: "fixture",
      authorizeUrl: "https://example.test/authorize",
      network: { mode: "system" },
      fingerprint: { ...fingerprint, unknownArgs: [raw] },
    })
    await expect(pending).rejects.toMatchObject({
      code: "BROWSER_START_FAILED",
      message: expect.stringContaining(`--${key}`),
    })
    await expect(pending).rejects.not.toThrow("private")
    expect(calls).toEqual([])
  })

  it("validates one snapshot of the managed bridge and callback", async () => {
    const { adapter, calls } = await createAdapter("darwin")
    let modeReads = 0
    let bridgeReads = 0
    let callbackReads = 0
    const network = {
      get mode() {
        modeReads += 1
        return "bound" as const
      },
      get bridgeUrl() {
        bridgeReads += 1
        return bridgeReads === 1 ? "socks5://127.0.0.1:9000" : "socks5://127.0.0.2:9000"
      },
      get callbackUri() {
        callbackReads += 1
        return callbackReads === 1
          ? "http://localhost:1234/callback"
          : "http://localhost:9000/callback"
      },
    }
    await adapter.launch({
      accountId: "fixture",
      authorizeUrl: "https://example.test/authorize",
      fingerprint,
      network,
    })
    expect(modeReads).toBe(1)
    expect(bridgeReads).toBe(1)
    expect(callbackReads).toBe(1)
    expect(calls[0]).toContain("--proxy-server=socks5://127.0.0.1:9000")
    expect(calls[0]).toContain("--proxy-bypass-list=<-loopback>;http://localhost:1234")
  })

  it("rejects a conflicting profile switch before bound authorization starts", async () => {
    const { adapter, calls } = await createAdapter("darwin")
    await expect(
      adapter.launch({
        accountId: "fixture",
        authorizeUrl: "https://example.test/authorize",
        network: {
          mode: "bound",
          bridgeUrl: "socks5://127.0.0.1:9000",
          callbackUri: "http://localhost:1234/callback",
        },
        fingerprint: { ...fingerprint, unknownArgs: ["--profile-directory=other"] },
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("--profile-directory") })
    expect(calls).toEqual([])
  })

  it("maps malformed runtime bridge values to a safe browser error", async () => {
    const { adapter, calls } = await createAdapter("darwin")
    const bridgeUrl = { toString: null, valueOf: null } as unknown as string
    await expect(
      adapter.launch({
        accountId: "fixture",
        authorizeUrl: "https://example.test/authorize",
        fingerprint,
        network: { mode: "bound", bridgeUrl, callbackUri: "http://localhost:1234/callback" },
      }),
    ).rejects.toMatchObject({ code: "BROWSER_START_FAILED" })
    expect(calls).toEqual([])
  })

  it.each([
    "http://localhost:0/callback",
    "http://localhost:65536/callback",
    "http://localhost:9000/callback",
    "http://127.0.0.1:1234/callback",
    "http://localhost:1234/other",
    "http://localhost:1234/callback?code=secret",
    "https://localhost:1234/callback",
  ])("rejects an invalid or conflicting managed callback %s", async (callbackUri) => {
    const { adapter, calls } = await createAdapter("darwin")
    await expect(
      adapter.launch({
        accountId: "fixture",
        authorizeUrl: "https://example.test/authorize",
        fingerprint,
        network: { mode: "bound", bridgeUrl: "socks5://127.0.0.1:9000", callbackUri },
      }),
    ).rejects.toMatchObject({ message: "授权回调地址无效或与代理桥端口冲突" })
    expect(calls).toEqual([])
  })

  it("rejects a reserved switch even after the argument terminator", async () => {
    const { adapter, calls } = await createAdapter("linux")
    await expect(
      adapter.launch({
        accountId: "fixture",
        authorizeUrl: "https://example.test/authorize",
        network: { mode: "system" },
        fingerprint: { ...fingerprint, unknownArgs: ["--", " --no-proxy-server "] },
      }),
    ).rejects.toMatchObject({ code: "BROWSER_START_FAILED" })
    expect(calls).toEqual([])
  })

  it.each([
    { args: ["--proxy-server"] },
    { args: ["--proxy-server="] },
    { args: ["--proxy-server", "http://example.test:8080"] },
    { args: ["--custom=value", "--proxy-server=a", "--proxy-server=b"] },
  ])("rejects reserved keys regardless of value or repetition: $args", async ({ args }) => {
    const { adapter, calls } = await createAdapter("linux")
    await expect(
      adapter.launch({
        accountId: "fixture",
        authorizeUrl: "https://example.test/authorize",
        network: { mode: "system" },
        fingerprint: { ...fingerprint, unknownArgs: args },
      }),
    ).rejects.toMatchObject({
      code: "BROWSER_START_FAILED",
      message: expect.stringContaining("--proxy-server"),
    })
    expect(calls).toEqual([])
  })

  it("keeps nonconflicting and extension arguments unchanged in system mode", async () => {
    const { adapter, calls } = await createAdapter("darwin")
    const unknownArgs = [
      " --load-extension=/synthetic/extension ",
      "--disable-extensions-except=/synthetic/extension",
      "--other=--proxy-server=example",
      "--profile-directory-extra=..",
      "---user-data-dir=example",
      "/proxy-server=posix-path",
      "--USER-DATA-DIR=case-sensitive",
      "\u00a0--user-data-dir=not-ascii-whitespace",
      "--host-rules=MAP * 127.0.0.1",
    ]
    await adapter.launch({
      accountId: "fixture",
      authorizeUrl: "https://example.test/authorize",
      network: { mode: "system" },
      fingerprint: { ...fingerprint, unknownArgs },
    })
    expect(calls[0]?.slice(-unknownArgs.length - 1)).toEqual([
      ...unknownArgs,
      "https://example.test/authorize",
    ])
  })

  it("does not treat a bound account with a missing bridge as system networking", async () => {
    const { adapter, calls } = await createAdapter("darwin")
    await expect(
      adapter.launch({
        accountId: "fixture",
        authorizeUrl: "https://example.test/authorize",
        fingerprint,
        network: { mode: "bound", bridgeUrl: "", callbackUri: "http://localhost:1234/callback" },
      }),
    ).rejects.toMatchObject({ code: "BROWSER_START_FAILED" })
    expect(calls).toEqual([])
  })

  it("rejects missing or contradictory runtime network modes", async () => {
    const { adapter, calls } = await createAdapter("darwin")
    const input = {
      accountId: "fixture",
      authorizeUrl: "https://example.test/authorize",
      fingerprint,
    }
    await expect(adapter.launch(input as LaunchBrowserInput)).rejects.toMatchObject({
      code: "BROWSER_START_FAILED",
    })
    const network = {
      mode: "system",
      bridgeUrl: "socks5://127.0.0.1:9000",
    } as unknown as LaunchBrowserNetwork
    await expect(adapter.launch({ ...input, network })).rejects.toMatchObject({
      code: "BROWSER_START_FAILED",
    })
    expect(calls).toEqual([])
  })

  it.each([
    "http://127.0.0.1:0",
    "http://127.0.0.1:9000",
    "socks5://127.0.0.1:0",
    "socks5://127.0.0.1:65536",
    "socks5://127.0.0.2:9000",
    "socks5://user:secret@127.0.0.1:9000",
    "socks5://127.0.0.1:9000/path",
  ])("rejects the invalid bound bridge %s without launching", async (bridgeUrl) => {
    const { adapter, calls } = await createAdapter("darwin")
    await expect(
      adapter.launch({
        accountId: "fixture",
        authorizeUrl: "https://example.test/authorize",
        fingerprint,
        network: { mode: "bound", bridgeUrl, callbackUri: "http://localhost:1234/callback" },
      }),
    ).rejects.toMatchObject({ code: "BROWSER_START_FAILED" })
    expect(calls).toEqual([])
  })

  it("keeps extension-loading arguments intact when bound authorization is blocked", async () => {
    const { adapter, calls } = await createAdapter("win32")
    const unknownArgs = [
      " --load-extension=/synthetic/extension ",
      "--disable-extensions-except=/synthetic/extension",
      "--webrtc-ip-handling-policy=default_public_interface_only",
      "--disable-non-proxied-udp",
    ]
    await expect(
      adapter.launch({
        accountId: "fixture",
        authorizeUrl: "https://example.test/authorize",
        fingerprint: { ...fingerprint, unknownArgs },
        network: {
          mode: "bound",
          bridgeUrl: "socks5://127.0.0.1:9000",
          callbackUri: "http://localhost:1234/callback",
        },
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("webrtc-ip-handling-policy") })
    expect(calls).toEqual([])
    expect(unknownArgs).toEqual([
      " --load-extension=/synthetic/extension ",
      "--disable-extensions-except=/synthetic/extension",
      "--webrtc-ip-handling-policy=default_public_interface_only",
      "--disable-non-proxied-udp",
    ])
  })

  it.each(["default_public_interface_only", "default_public_and_private_interfaces"] as const)(
    "rejects WebRTC policy %s for a bound proxy before launching",
    async (webrtcPolicy) => {
      const { adapter, calls } = await createAdapter("darwin")
      await expect(
        adapter.launch({
          accountId: "fixture",
          authorizeUrl: "https://example.test/authorize",
          fingerprint: { ...fingerprint, webrtcPolicy },
          network: {
            mode: "bound",
            bridgeUrl: "socks5://127.0.0.1:9000",
            callbackUri: "http://localhost:1234/callback",
          },
        }),
      ).rejects.toMatchObject({ message: expect.stringContaining("WebRTC") })
      expect(calls).toEqual([])
    },
  )

  it("uses the same fingerprint snapshot that it checked", async () => {
    const { adapter, calls } = await createAdapter("darwin")
    const unknownArgs = ["--load-extension=/synthetic/extension"]
    const pending = adapter.launch({
      accountId: "fixture",
      authorizeUrl: "https://example.test/authorize",
      fingerprint: { ...fingerprint, unknownArgs },
      network: { mode: "system" },
    })
    unknownArgs.push("--no-proxy-server")
    await pending
    expect(calls[0]).toContain("--load-extension=/synthetic/extension")
    expect(calls[0]).not.toContain("--no-proxy-server")
  })
})

async function createAdapter(hostPlatform: NodeJS.Platform) {
  const root = await mkdtemp(join(tmpdir(), "launch-guard-"))
  roots.push(root)
  const calls: string[][] = []
  const fakeSpawn = ((_binary: string, args: string[]): ChildProcess => {
    calls.push(args)
    const child = Object.assign(new EventEmitter(), { pid: 1234, unref: () => undefined })
    queueMicrotask(() => child.emit("spawn"))
    return child as unknown as ChildProcess
  }) as typeof spawn
  return {
    adapter: new FingerprintChromiumAdapter({
      hostArch: process.arch,
      binaryPath: process.execPath,
      profilesRoot: root,
      hostPlatform,
      spawn: fakeSpawn,
    }),
    calls,
  }
}
