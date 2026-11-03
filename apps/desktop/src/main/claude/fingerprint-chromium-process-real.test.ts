// 用临时目录和合成子进程验证启动器等待操作系统进程退出，不启动浏览器或访问网络。

import { spawn, type ChildProcess } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { createSyntheticBrowserAdapter } from "./browser-startup-test-utils"

it("confirms that the actual spawned child has exited before removing the profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-real-process-"))
  let child: ChildProcess | null = null
  const syntheticSpawn = (() => {
    child = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 10_000)"], {
      detached: true,
      stdio: "ignore",
    })
    return child
  }) as typeof spawn
  const adapter = createSyntheticBrowserAdapter({
    hostArch: process.arch,
    binaryPath: process.execPath,
    profilesRoot: root,
    spawn: syntheticSpawn,
  })
  try {
    const launched = await adapter.launch({
      accountId: "synthetic",
      authorizeUrl: "https://example.test/authorize",
      network: { mode: "system" },
      fingerprint: {
        seed: "42",
        brand: "Chrome",
        platform: "macos",
        lang: "en-US",
        timezone: "UTC",
        canvasNoise: "",
        clientRectsNoise: "",
      },
    })
    expect(launched.pid).toBeGreaterThan(0)
    await adapter.deleteProfile("synthetic")
    expect(child).not.toBeNull()
    const result = child as ChildProcess | null
    expect(result?.exitCode != null || result?.signalCode != null).toBe(true)
  } finally {
    await adapter.dispose().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})
