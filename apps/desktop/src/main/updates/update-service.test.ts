// 验证更新服务：用本地假更新源驱动检查、下载、校验、各平台的安装路径和失败，以及不降级和关闭检查。
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DesktopUpdateState } from "@pigclaude/ui-contracts"
import { afterEach, describe, expect, it, vi } from "vitest"
import { startFakeUpdateSource, type FakeUpdateSource } from "../testing/fake-update-source"
import { downloadVerifiedPackage } from "./mac-update-package"
import { fetchLatestRelease } from "./update-release"
import { createUpdateService, type UpdateMode, type UpdateServiceOptions } from "./update-service"

let source: FakeUpdateSource | null = null
let directory = ""

afterEach(async () => {
  await source?.close()
  source = null
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = ""
})

async function setup(
  mode: UpdateMode,
  sourceOptions: Parameters<typeof startFakeUpdateSource>[0],
  overrides: Partial<UpdateServiceOptions> = {},
) {
  const fake = await startFakeUpdateSource(sourceOptions)
  source = fake
  directory = await mkdtemp(join(tmpdir(), "pigclaude-update-service-"))
  const states: DesktopUpdateState[] = []
  const calls = {
    download: vi.fn(async (onProgress: (percent: number) => void) => onProgress(50)),
    quitAndInstall: vi.fn(async () => undefined),
    openPath: vi.fn<(path: string) => Promise<void>>(async () => undefined),
    openExternal: vi.fn<(url: string) => Promise<void>>(async () => undefined),
    requestQuit: vi.fn(),
    saveAutoCheck: vi.fn<(value: boolean) => Promise<void>>(async () => undefined),
  }
  const service = createUpdateService({
    currentVersion: "1.0.0",
    mode,
    arch: "arm64",
    enabled: true,
    autoCheck: () => true,
    saveAutoCheck: calls.saveAutoCheck,
    findRelease: () => fetchLatestRelease(fake.apiUrl),
    fetchText: async (url) => (await fetch(url)).text(),
    downloadMacPackage: (pkg, onProgress) =>
      downloadVerifiedPackage(pkg, directory, fetch, onProgress),
    installer: { download: calls.download, quitAndInstall: calls.quitAndInstall },
    openPath: calls.openPath,
    openExternal: calls.openExternal,
    requestQuit: calls.requestQuit,
    onState: (state) => states.push(state),
    ...overrides,
  })
  return { service, states, calls, fake }
}

async function settle(service: { getState(): DesktopUpdateState }): Promise<DesktopUpdateState> {
  await vi.waitFor(() => {
    expect(["checking", "downloading"]).not.toContain(service.getState().phase)
  })
  return service.getState()
}

describe("macOS：下载 DMG 校验后手动替换", () => {
  it("发现新版本后按芯片下载 DMG，sha512 一致才提示打开安装包并退出", async () => {
    const { service, calls, fake } = await setup("replace", { version: "1.1.0" })
    await expect(service.checkNow()).resolves.toEqual({
      status: "update-available",
      version: "1.1.0",
      url: fake.releaseUrl,
    })
    const ready = await settle(service)
    expect(ready).toMatchObject({ phase: "ready", action: "open-package", progress: 100 })
    const path = join(directory, "PigClaude-1.1.0-arm64.dmg")
    await expect(readFile(path, "utf8")).resolves.toBe("dmg-content")

    await service.perform()
    expect(calls.openPath).toHaveBeenCalledWith(path)
    expect(calls.requestQuit).toHaveBeenCalledTimes(1)
  })

  it("下载的 DMG 和清单的 sha512 不一致时删掉文件、记为下载失败，可以重试", async () => {
    const { service, fake } = await setup("replace", {
      version: "1.1.0",
      dmg: Buffer.from("dmg-tampered"),
      manifestDmg: Buffer.from("dmg-original"),
    })
    await service.checkNow()
    expect(await settle(service)).toMatchObject({
      phase: "failed",
      action: "download",
      error: "download",
      url: fake.releaseUrl,
    })
    await expect(readFile(join(directory, "PigClaude-1.1.0-arm64.dmg.part"))).rejects.toThrow()

    await service.perform()
    expect(fake.requests.filter((path) => path.endsWith(".dmg"))).toHaveLength(2)
  })

  it("发布里没有 macOS 更新清单时改为打开发布页", async () => {
    const { service, calls, fake } = await setup("replace", {
      version: "1.1.0",
      withManifest: false,
    })
    await service.checkNow()
    expect(await settle(service)).toMatchObject({ phase: "available", action: "open-release" })
    await service.perform()
    expect(calls.openExternal).toHaveBeenCalledWith(fake.releaseUrl)
  })
})

describe("Windows、Linux：后台下载，退出时安装", () => {
  it("发现新版本后自动下载，下载好只提示，不自动重启", async () => {
    const { service, calls } = await setup("install", { version: "1.1.0" })
    await service.checkNow()
    expect(await settle(service)).toMatchObject({ phase: "ready", action: "restart" })
    expect(calls.download).toHaveBeenCalledTimes(1)
    expect(calls.requestQuit).not.toHaveBeenCalled()
    expect(calls.quitAndInstall).not.toHaveBeenCalled()
  })

  it("「重启并更新」走统一退出；确认后才在最后一步启动安装器，取消就作罢", async () => {
    const { service, calls } = await setup("install", { version: "1.1.0" })
    await service.checkNow()
    await settle(service)

    await service.perform()
    expect(calls.requestQuit).toHaveBeenCalledTimes(1)
    expect(service.restartRequested()).toBe(true)
    service.cancelRestart()
    expect(service.restartRequested()).toBe(false)

    await service.perform()
    await service.installAndRestart()
    expect(calls.quitAndInstall).toHaveBeenCalledTimes(1)
    expect(service.restartRequested()).toBe(false)
  })

  it("安装器启动失败时记为安装失败", async () => {
    const { service } = await setup(
      "install",
      { version: "1.1.0" },
      {
        installer: {
          download: async () => undefined,
          quitAndInstall: async () => Promise.reject(new Error("spawn failed")),
        },
      },
    )
    await service.checkNow()
    await settle(service)
    await service.installAndRestart()
    expect(service.getState()).toMatchObject({ phase: "failed", error: "install" })
  })

  it("下载失败时可以重试", async () => {
    const download = vi
      .fn<(onProgress: (percent: number) => void) => Promise<void>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(undefined)
    const { service } = await setup(
      "install",
      { version: "1.1.0" },
      { installer: { download, quitAndInstall: async () => undefined } },
    )
    await service.checkNow()
    expect(await settle(service)).toMatchObject({ phase: "failed", action: "download" })
    await service.perform()
    expect(service.getState()).toMatchObject({ phase: "ready", action: "restart" })
  })
})

describe("检查", () => {
  it("同版本和更低版本都不算更新，不会降级", async () => {
    for (const version of ["1.0.0", "0.9.9"]) {
      const { service, calls } = await setup("install", { version })
      await expect(service.checkNow()).resolves.toEqual({ status: "up-to-date" })
      expect(service.getState()).toMatchObject({ phase: "idle", version: null, action: null })
      expect(calls.download).not.toHaveBeenCalled()
      await source?.close()
      source = null
    }
  })

  it("发布源出错时记为检查失败，开发运行只给发布页", async () => {
    const failing = await setup("notify", { version: "1.1.0", releaseStatus: 500 })
    await expect(failing.service.checkNow()).resolves.toEqual({ status: "error" })
    expect(failing.service.getState()).toMatchObject({ phase: "failed", error: "check" })
    await source?.close()

    const { service } = await setup("notify", { version: "1.1.0" })
    await service.checkNow()
    expect(service.getState()).toMatchObject({ phase: "available", action: "open-release" })
  })

  it("环境变量关闭检查时不发出任何请求", async () => {
    const { service, fake } = await setup("install", { version: "1.1.0" }, { enabled: false })
    service.start()
    await expect(service.checkNow()).resolves.toEqual({ status: "error" })
    service.stop()
    expect(fake.requests).toEqual([])
  })

  it("关掉自动检查会保存开关并停止定时检查；发布页只能打开主进程持有的地址", async () => {
    const timers = {
      setTimeout: vi.fn(() => 1),
      setInterval: vi.fn(() => 2),
      clearTimeout: vi.fn(),
      clearInterval: vi.fn(),
    }
    let autoCheck = true
    const { service, calls, fake } = await setup(
      "notify",
      { version: "1.1.0" },
      {
        timers,
        autoCheck: () => autoCheck,
        saveAutoCheck: async (value) => {
          autoCheck = value
        },
      },
    )
    service.start()
    expect(timers.setTimeout).toHaveBeenCalledTimes(1)
    await expect(service.setAutoCheck(false)).resolves.toMatchObject({ autoCheck: false })
    expect(timers.setTimeout).toHaveBeenCalledTimes(1)
    expect(timers.clearInterval).toHaveBeenCalledWith(2)

    await service.openReleaseNotes()
    expect(calls.openExternal).not.toHaveBeenCalled()
    await service.checkNow()
    await service.openReleaseNotes()
    expect(calls.openExternal).toHaveBeenCalledWith(fake.releaseUrl)
  })
})
