// 通过桌面代理服务和真实 Xray 验证合成上游代理的认证、出口及资源回收。

import { spawn, type SpawnOptions } from "node:child_process"
import { copyFile, link, mkdir, mkdtemp, rm } from "node:fs/promises"
import { connect } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LocalStore } from "@pigclaude/local-store"
import type { ProxyRuntime } from "@pigclaude/login-gate/proxy-runtime"
import { describe, expect, it } from "vitest"
import { ProxyService } from "./proxy-service"
import { createXrayRuntimeStarter } from "./xray-runtime"
import { createProxyFixture } from "./xray-egress-fixture"

const xrayBinary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]

it("启动失败但已确认退出时，允许重新尝试", async () => {
  let spawns = 0
  const capture = ((command: string, args: string[], options: SpawnOptions) => {
    spawns += 1
    return spawn(command, args, options)
  }) as typeof spawn
  const start = createXrayRuntimeStarter({
    idleTimeoutMs: 0,
    binaryPath: process.execPath,
    hostArch: process.arch,
    spawn: capture,
  })
  await expect(start({ upstreamProxyUrl: "http://127.0.0.1:9" })).rejects.toMatchObject({
    code: "PROXY_UNAVAILABLE",
  })
  await expect(start({ upstreamProxyUrl: "http://127.0.0.1:9" })).rejects.toMatchObject({
    code: "PROXY_UNAVAILABLE",
  })
  expect(spawns).toBe(2)
  await new Promise((resolve) => setTimeout(resolve, 100))
  await expect(start.dispose()).resolves.toBeUndefined()
})

describe.skipIf(!xrayBinary)("真实 Xray 桌面出口核对", () => {
  it.each(["http", "socks5"] as const)("新 %s 代理通过 Xray 出口核对后才保存", async (protocol) => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-xray-new-proxy-"))
    const fixture = await createProxyFixture()
    const starter = createXrayRuntimeStarter({
      idleTimeoutMs: 0,
      hostArch: process.arch,
      binaryPath: xrayBinary,
    })
    try {
      const store = new LocalStore(directory)
      const service = new ProxyService({
        store,
        checkUrl: `http://127.0.0.1:${fixture.targetPort}/trace`,
        startProxyRuntime: starter,
      })
      const httpUpstream = `http://user%40test:p%3Ass@127.0.0.1:${fixture.proxyPort}`
      const upstream =
        protocol === "socks5" ? await starter({ upstreamProxyUrl: httpUpstream }) : null
      const result = await service.saveVerified({
        name: "验收代理",
        url: upstream?.url ?? httpUpstream,
      })
      expect(result.lastTest).toMatchObject({ ok: true, ip: "198.51.100.42" })
      if (protocol === "http") expect(result.url).toContain("***")
      else expect(result.url).toBe(upstream?.url)
      expect(result.url).not.toContain("p%3Ass")
      expect(await store.listProxies()).toHaveLength(1)
      expect(fixture.accepted()).toBe(2)
      expect(fixture.directRequests()).toBe(0)
    } finally {
      await starter.dispose()
      await fixture.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each(["http", "socks5"] as const)("%s 出口核对失败时不保存新代理或直连", async (protocol) => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-xray-rejected-proxy-"))
    const fixture = await createProxyFixture()
    const starter = createXrayRuntimeStarter({
      idleTimeoutMs: 0,
      hostArch: process.arch,
      binaryPath: xrayBinary,
    })
    try {
      const upstream =
        protocol === "socks5"
          ? await starter({
              upstreamProxyUrl: `http://user%40test:p%3Ass@127.0.0.1:${fixture.proxyPort}`,
            })
          : null
      const store = new LocalStore(directory)
      const service = new ProxyService({
        store,
        checkUrl: `http://127.0.0.1:${fixture.targetPort}/trace`,
        startProxyRuntime: async (input) => {
          const runtime = await starter(input)
          // 关闭已绑定的 SOCKS5 上游时，本次 Xray 的入口仍然存活。
          await upstream?.close()
          return runtime
        },
      })
      await expect(
        service.saveVerified({
          name: "失败代理",
          url: upstream?.url ?? `http://bad:bad@127.0.0.1:${fixture.proxyPort}`,
        }),
      ).rejects.toMatchObject({ code: "PROXY_UNAVAILABLE" })
      expect(await store.listProxies()).toEqual([])
      expect(fixture.targetRequests()).toBe(0)
    } finally {
      await starter.dispose()
      await fixture.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("通过本机 Xray 与合成账密代理取得相同出口", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-xray-egress-"))
    const fixture = await createProxyFixture()
    let runtime: ProxyRuntime | undefined
    try {
      const store = new LocalStore(directory)
      await store.saveProxy({
        schemaVersion: 1,
        id: "proxy",
        name: "合成代理",
        url: `http://user%40test:p%3Ass@127.0.0.1:${fixture.proxyPort}`,
        lastTest: null,
      })
      const service = new ProxyService({
        store,
        checkUrl: `http://127.0.0.1:${fixture.targetPort}/trace`,
        startProxyRuntime: async (input) => {
          runtime = await createXrayRuntimeStarter({
            idleTimeoutMs: 0,
            hostArch: process.arch,
            binaryPath: xrayBinary,
          })(input)
          return runtime
        },
      })

      await expect(service.checkEgress("proxy")).resolves.toEqual({
        ok: true,
        ip: "198.51.100.42",
      })
      expect(fixture.accepted()).toBe(2)
      expect(fixture.targetRequests()).toBe(2)
      expect(runtime).toBeDefined()
      await expect(portIsOpen(new URL(runtime!.url))).resolves.toBe(false)
    } finally {
      await fixture.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("出口检查重定向仍经过 Xray 与绑定代理", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-xray-egress-"))
    const fixture = await createProxyFixture()
    try {
      const store = new LocalStore(directory)
      await store.saveProxy({
        schemaVersion: 1,
        id: "proxy",
        name: "合成代理",
        url: `http://user%40test:p%3Ass@127.0.0.1:${fixture.proxyPort}`,
        lastTest: null,
      })
      const service = new ProxyService({
        store,
        checkUrl: `http://127.0.0.1:${fixture.targetPort}/redirect`,
        startProxyRuntime: createXrayRuntimeStarter({
          idleTimeoutMs: 0,
          hostArch: process.arch,
          binaryPath: xrayBinary,
        }),
      })
      await expect(service.checkEgress("proxy")).resolves.toEqual({
        ok: true,
        ip: "198.51.100.42",
      })
      expect(fixture.targetRequests()).toBe(4)
      expect(fixture.directRequests()).toBe(0)
    } finally {
      await fixture.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each([
    ["first", 1],
    ["second", 2],
  ] as const)("出口检查在 %s 路拒绝重定向到本地 data 地址", async (phase, expectedRequests) => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-xray-egress-"))
    const fixture = await createProxyFixture()
    try {
      const store = new LocalStore(directory)
      await store.saveProxy({
        schemaVersion: 1,
        id: "proxy",
        name: "合成代理",
        url: `http://user%40test:p%3Ass@127.0.0.1:${fixture.proxyPort}`,
        lastTest: null,
      })
      const service = new ProxyService({
        store,
        checkUrl: `http://127.0.0.1:${fixture.targetPort}/redirect-data-${phase}`,
        startProxyRuntime: createXrayRuntimeStarter({
          idleTimeoutMs: 0,
          hostArch: process.arch,
          binaryPath: xrayBinary,
        }),
      })
      await expect(service.checkEgress("proxy")).resolves.toMatchObject({
        ok: false,
        reason: "proxy",
      })
      expect(fixture.targetRequests()).toBe(expectedRequests)
      expect(fixture.directRequests()).toBe(0)
    } finally {
      await fixture.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("错误账密无法访问目标且不会转为直连", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-xray-egress-"))
    const fixture = await createProxyFixture()
    try {
      const store = new LocalStore(directory)
      await store.saveProxy({
        schemaVersion: 1,
        id: "proxy",
        name: "合成代理",
        url: `http://user%40test:wrong@127.0.0.1:${fixture.proxyPort}`,
        lastTest: null,
      })
      const service = new ProxyService({
        store,
        checkUrl: `http://127.0.0.1:${fixture.targetPort}/trace`,
        startProxyRuntime: createXrayRuntimeStarter({
          idleTimeoutMs: 0,
          hostArch: process.arch,
          binaryPath: xrayBinary,
        }),
      })

      await expect(service.checkEgress("proxy")).resolves.toMatchObject({
        ok: false,
        reason: "proxy",
      })
      expect(fixture.targetRequests()).toBe(0)
    } finally {
      await fixture.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each([
    ["name@", "name:"],
    [":secret@", ":secret"],
  ])("单字段账密 %s 与已有上游认证语义一致", async (credentials, decoded) => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-xray-egress-"))
    const fixture = await createProxyFixture(decoded)
    try {
      const store = new LocalStore(directory)
      await store.saveProxy({
        schemaVersion: 1,
        id: "proxy",
        name: "合成代理",
        url: `http://${credentials}127.0.0.1:${fixture.proxyPort}`,
        lastTest: null,
      })
      const service = new ProxyService({
        store,
        checkUrl: `http://127.0.0.1:${fixture.targetPort}/trace`,
        startProxyRuntime: createXrayRuntimeStarter({
          idleTimeoutMs: 0,
          hostArch: process.arch,
          binaryPath: xrayBinary,
        }),
      })
      await expect(service.checkEgress("proxy")).resolves.toEqual({
        ok: true,
        ip: "198.51.100.42",
      })
      expect(fixture.targetRequests()).toBe(2)
    } finally {
      await fixture.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each(["upstream", "xray"] as const)("%s 中断时出口核对失败且不访问目标", async (failure) => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-xray-egress-"))
    const fixture = await createProxyFixture()
    try {
      const store = new LocalStore(directory)
      await store.saveProxy({
        schemaVersion: 1,
        id: "proxy",
        name: "合成代理",
        url: `http://user%40test:p%3Ass@127.0.0.1:${fixture.proxyPort}`,
        lastTest: null,
      })
      const start = createXrayRuntimeStarter({
        idleTimeoutMs: 0,
        hostArch: process.arch,
        binaryPath: xrayBinary,
      })
      const service = new ProxyService({
        store,
        checkUrl: `http://127.0.0.1:${fixture.targetPort}/trace`,
        startProxyRuntime: async (input) => {
          const runtime = await start(input)
          if (failure === "upstream") fixture.failProxy()
          else await start.dispose()
          return runtime
        },
      })
      const result = service.checkEgress("proxy")
      if (failure === "xray") {
        await expect(result).rejects.toMatchObject({ code: "PROXY_UNAVAILABLE" })
      } else {
        await expect(result).resolves.toMatchObject({ ok: false })
      }
      expect(fixture.targetRequests()).toBe(0)
    } finally {
      await fixture.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("出口核对期间 Xray 退出时不会报告成功", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-xray-egress-"))
    const fixture = await createProxyFixture()
    try {
      const store = new LocalStore(directory)
      await store.saveProxy({
        schemaVersion: 1,
        id: "proxy",
        name: "合成代理",
        url: `http://user%40test:p%3Ass@127.0.0.1:${fixture.proxyPort}`,
        lastTest: null,
      })
      const start = createXrayRuntimeStarter({
        idleTimeoutMs: 0,
        hostArch: process.arch,
        binaryPath: xrayBinary,
      })
      const service = new ProxyService({
        store,
        checkUrl: `http://127.0.0.1:${fixture.targetPort}/trace`,
        startProxyRuntime: async (input) => {
          const runtime = await start(input)
          fixture.onTarget(async (count) => {
            if (count === 2) await runtime.close()
          })
          return runtime
        },
      })
      await expect(service.checkEgress("proxy")).rejects.toMatchObject({
        code: "PROXY_UNAVAILABLE",
      })
    } finally {
      await fixture.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("Xray 文件缺失时及时返回稳定错误且不访问目标", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-xray-egress-"))
    const fixture = await createProxyFixture()
    try {
      const store = new LocalStore(directory)
      await store.saveProxy({
        schemaVersion: 1,
        id: "proxy",
        name: "合成代理",
        url: `http://user%40test:p%3Ass@127.0.0.1:${fixture.proxyPort}`,
        lastTest: null,
      })
      const service = new ProxyService({
        store,
        checkUrl: `http://127.0.0.1:${fixture.targetPort}/trace`,
        startProxyRuntime: createXrayRuntimeStarter({
          idleTimeoutMs: 0,
          hostArch: process.arch,
          binaryPath: join(directory, "missing"),
        }),
      })

      await expect(service.checkEgress("proxy")).rejects.toMatchObject({
        code: "PROXY_UNAVAILABLE",
      })
      expect(fixture.targetRequests()).toBe(0)
    } finally {
      await fixture.close()
      await rm(directory, { recursive: true, force: true })
    }
  }, 2_000)

  it("从当前系统和架构的资源目录启动真实 Xray", async () => {
    if (!xrayBinary) throw new Error("缺少测试用 Xray")
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-xray-egress-"))
    const fixture = await createProxyFixture()
    try {
      const assetDirectory = join(
        directory,
        "pigclaude-runtime",
        "xray",
        `${process.platform}-${process.arch}`,
      )
      await mkdir(assetDirectory, { recursive: true })
      const asset = join(assetDirectory, process.platform === "win32" ? "xray.exe" : "xray")
      await link(xrayBinary, asset).catch(() => copyFile(xrayBinary, asset))
      const store = new LocalStore(join(directory, "store"))
      await store.saveProxy({
        schemaVersion: 1,
        id: "proxy",
        name: "合成代理",
        url: `http://user%40test:p%3Ass@127.0.0.1:${fixture.proxyPort}`,
        lastTest: null,
      })
      const service = new ProxyService({
        store,
        checkUrl: `http://127.0.0.1:${fixture.targetPort}/trace`,
        startProxyRuntime: createXrayRuntimeStarter({
          idleTimeoutMs: 0,
          hostArch: process.arch,
          resourcesPath: directory,
          env: {},
        }),
      })
      await expect(service.checkEgress("proxy")).resolves.toMatchObject({ ok: true })
    } finally {
      await fixture.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})

async function portIsOpen(url: URL): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = connect(Number(url.port), url.hostname)
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => resolve(false))
  })
}
