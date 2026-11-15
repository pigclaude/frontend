// 用系统替身和临时目录验证各平台的开机自启登记与启动检测。

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import { createLoginStartup } from "./login-startup"

it("在 Windows 登记带后台启动参数的当前程序，并识别系统里停用的项目", async () => {
  const executable = "C:\\Program Files\\PigClaude\\PigClaude.exe"
  const get = vi
    .fn()
    .mockReturnValueOnce({ launchItems: [] })
    .mockReturnValueOnce({
      launchItems: [{ name: "com.pigclaude.desktop.autostart", scope: "user", enabled: true }],
    })
    .mockReturnValueOnce({
      launchItems: [{ name: "com.pigclaude.desktop.autostart", scope: "user", enabled: false }],
    })
    .mockReturnValue({ launchItems: [] })
  const set = vi.fn()
  const startup = createLoginStartup({
    platform: "win32",
    packaged: true,
    executable,
    home: "/unused",
    env: {},
    native: { getLoginItemSettings: get, setLoginItemSettings: set },
  })
  const parameters = { path: `"${executable}"`, args: ["--pigclaude-autostart"] }

  expect(await startup.enabled()).toBe(false)
  await expect(startup.set(true)).resolves.toBe(true)
  expect(set).toHaveBeenCalledExactlyOnceWith({
    ...parameters,
    openAtLogin: true,
    name: "com.pigclaude.desktop.autostart",
  })
  expect(get).toHaveBeenLastCalledWith(parameters)
  expect(await startup.enabled()).toBe(false)
  expect(startup.openedAutomatically(["--pigclaude-autostart"])).toBe(true)
  expect(startup.openedAutomatically(["--pigclaude-autostart=false"])).toBe(false)
  await expect(startup.set(false)).resolves.toBe(false)
  expect(set).toHaveBeenLastCalledWith({
    ...parameters,
    openAtLogin: false,
    name: "com.pigclaude.desktop.autostart",
  })
})

it("在 macOS 使用登录项 API，并识别系统报告的自动启动", async () => {
  let openAtLogin = false
  const set = vi.fn((settings: { openAtLogin?: boolean }) => {
    openAtLogin = settings.openAtLogin === true
  })
  const startup = createLoginStartup({
    platform: "darwin",
    packaged: true,
    executable: "/test/PigClaude.app/Contents/MacOS/PigClaude",
    home: "/unused",
    env: {},
    native: {
      getLoginItemSettings: () => ({ openAtLogin, wasOpenedAtLogin: true }),
      setLoginItemSettings: set,
    },
  })

  expect(await startup.enabled()).toBe(false)
  expect(startup.openedAutomatically([])).toBe(true)
  await expect(startup.set(true)).resolves.toBe(true)
  await expect(startup.set(false)).resolves.toBe(false)
  expect(set.mock.calls.map(([value]) => value)).toEqual([
    { openAtLogin: true },
    { openAtLogin: false },
  ])
})

it("在 Linux 用稳定的 AppImage 路径登记 XDG 入口，识别停用并支持移除", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-xdg-autostart-"))
  try {
    const config = join(directory, "xdg")
    const native = { getLoginItemSettings: vi.fn(), setLoginItemSettings: vi.fn() }
    const startup = createLoginStartup({
      platform: "linux",
      packaged: true,
      executable: "/tmp/appimage-mount/pigclaude",
      home: join(directory, "home"),
      env: { XDG_CONFIG_HOME: config, APPIMAGE: "/test apps/PigClaude 100%.AppImage" },
      native,
    })
    const file = join(config, "autostart", "pigclaude-autostart.desktop")
    expect(await startup.enabled()).toBe(false)
    expect(await startup.set(true)).toBe(true)
    const entry = await readFile(file, "utf8")
    expect(entry.split("\n")).toContain(
      'Exec="/test apps/PigClaude 100%%.AppImage" --pigclaude-autostart',
    )
    expect(await startup.enabled()).toBe(true)

    await writeFile(file, entry + "Hidden=true\n")
    expect(await startup.enabled()).toBe(false)
    expect(await startup.set(false)).toBe(false)
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" })
    expect(startup.openedAutomatically(["--pigclaude-autostart"])).toBe(true)
    expect(native.setLoginItemSettings).not.toHaveBeenCalled()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it("开发运行不登记 Electron 程序，系统静默拒绝时报告失败", async () => {
  const native = {
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    setLoginItemSettings: vi.fn(),
  }
  const options = {
    platform: "darwin" as const,
    executable: "/test/Electron.app/Contents/MacOS/Electron",
    home: "/unused",
    env: {},
    native,
  }
  const developer = createLoginStartup({ ...options, packaged: false })
  expect(await developer.enabled()).toBeNull()
  await expect(developer.set(true)).rejects.toThrow("STARTUP_LOGIN_ITEM_UNAVAILABLE")
  expect(native.setLoginItemSettings).not.toHaveBeenCalled()

  const installed = createLoginStartup({ ...options, packaged: true })
  await expect(installed.set(true)).rejects.toThrow("STARTUP_LOGIN_ITEM_UNCHANGED")
})
