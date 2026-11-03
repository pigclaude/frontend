// 验证已提供合成保护证明时，浏览器启动器只为本次授权回调设置回环代理例外。

import { EventEmitter } from "node:events"
import type { ChildProcess, spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { expect, it } from "vitest"
import { FingerprintChromiumAdapter } from "./fingerprint-chromium"

class SyntheticProtectedBrowser extends FingerprintChromiumAdapter {
  /** 合成测试只验证启动参数，不声明真实浏览器具有代理强制能力。 */
  override ensureBoundProxyProtection(): void {}
}

it("每次绑定启动只放行该次 localhost 回调端口，并保留扩展", async () => {
  const root = await mkdtemp(join(tmpdir(), "pigclaude-callback-route-"))
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
  const adapter = new SyntheticProtectedBrowser({
    binaryPath: process.execPath,
    hostArch: process.arch,
    profilesRoot: root,
    spawn: fakeSpawn,
  })
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
  try {
    for (const port of [43123, 43124]) {
      await adapter.launch({
        accountId: "synthetic",
        authorizeUrl: "https://example.test/authorize",
        network: {
          mode: "bound",
          bridgeUrl: "socks5://127.0.0.1:31999",
          callbackUri: `http://localhost:${port}/callback`,
        },
        fingerprint,
      })
    }
    expect(calls[0]).toContain("--proxy-bypass-list=<-loopback>;http://localhost:43123")
    expect(calls[1]).toContain("--proxy-bypass-list=<-loopback>;http://localhost:43124")
    expect(calls[1]).not.toContain("--proxy-bypass-list=<-loopback>;http://localhost:43123")
    expect(calls[1]).toContain("--load-extension=/synthetic/extension")
    expect(calls[0]).toContain("--disable-non-proxied-udp")
    expect(calls[1]).toContain("--disable-non-proxied-udp")
    expect(calls[0]).toContain(
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
    )
  } finally {
    await adapter.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
