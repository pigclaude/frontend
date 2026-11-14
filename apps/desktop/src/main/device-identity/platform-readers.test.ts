// 负责以系统读取替身验证平台唯一来源、固定命令和失败隔离。
import { afterEach, describe, expect, it, vi } from "vitest"
import { MacOsMachineIdReader } from "./macos-reader"
import { WindowsMachineIdReader } from "./windows-reader"
import { LinuxMachineIdReader } from "./linux-reader"
import { createDesktopComposition } from "../composition"
import { profileApi, ProfileVault } from "../testing/profile-fixture"
import { createPlatformMachineIdReader, runMachineIdCommand } from "./platform-reader"

const raw = "01234567-89AB-CDEF-0123-456789ABCDEF"
const processFixture = vi.hoisted(() => ({ exec: vi.fn(), readFile: vi.fn() }))
vi.mock("node:child_process", () => ({ execFile: processFixture.exec }))
vi.mock("node:fs/promises", () => ({ readFile: processFixture.readFile }))
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe("fixed platform readers", () => {
  it("uses the real default service and platform adapter in composition without a constant fallback", async () => {
    processFixture.exec.mockImplementationOnce((file, _args, _options, callback) => {
      callback(null, file === "/usr/sbin/ioreg" ? `"IOPlatformUUID" = "${raw}"` : raw, "")
    })
    processFixture.readFile.mockResolvedValueOnce("0123456789abcdef0123456789abcdef")
    const expected: Record<string, string> = {
      darwin: "pcd_77d95e81bc3fd6401209110cb1e22cc2961ec055ad4c95cfe63e51b6cefec0c2",
      win32: "pcd_86de834472485a4f2cf6fa560e66733df761687e0a0f8e99dc5a865515f1efc4",
      linux: "pcd_fd96fc37ac88519436178e324b4301a727062e286c3718550a1e1085405f337e",
    }
    let sent: unknown
    const composition = createDesktopComposition({
      vault: new ProfileVault(),
      authOrigin: "http://127.0.0.1:8788",
      deviceInfo: async () => ({
        name: "fixture",
        osVersion: "macOS 15.4",
        appVersion: "1.3.0",
      }),
      api: profileApi({
        prepareDeviceAuthorization: async (input) => {
          sent = input
          return {
            contextId: "flow",
            authorizationUrl: "http://127.0.0.1:8788/authorize/flow",
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
          }
        },
      }),
    })
    await composition.authorizationService.start(
      { purpose: "pigclaude-login", mode: "login" },
      "http://127.0.0.1:43123/oauth/callback",
    )
    expect(sent).toMatchObject({ deviceId: expected[process.platform] })
    expect(JSON.stringify(sent)).not.toContain(raw)
    await composition.dispose()
  })
  it("does not reflect synchronous process execution failures", async () => {
    processFixture.exec.mockImplementationOnce(() => {
      throw new Error(raw)
    })
    await expect(runMachineIdCommand("/usr/sbin/ioreg", ["-rd1"])).rejects.toThrow(
      "DEVICE_ID_UNAVAILABLE",
    )
  })
  it("uses Node file IO by default on Linux", async () => {
    processFixture.readFile.mockResolvedValueOnce("0123456789abcdef0123456789abcdef\n")
    expect(await new LinuxMachineIdReader().read()).toEqual({
      platform: "linux",
      machineId: "0123456789abcdef0123456789abcdef\n",
    })
  })
  it("reads only macOS IOPlatformUUID via fixed read-only ioreg arguments", async () => {
    const run = vi.fn(async () => `| { "IOPlatformUUID" = "${raw}" }`)
    expect(await new MacOsMachineIdReader(run).read()).toEqual({
      platform: "darwin",
      machineId: raw,
    })
    expect(run).toHaveBeenCalledExactlyOnceWith("/usr/sbin/ioreg", [
      "-rd1",
      "-c",
      "IOPlatformExpertDevice",
    ])
  })
  it("reads only Windows SMBIOS UUID using CIM without MachineGuid", async () => {
    const run = vi.fn(async () => `${raw}\r\n`)
    expect(await new WindowsMachineIdReader(run).read()).toEqual({
      platform: "win32",
      machineId: raw,
    })
    expect(run).toHaveBeenCalledExactlyOnceWith("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "(Get-CimInstance -ClassName Win32_ComputerSystemProduct -ErrorAction Stop).UUID",
    ])
  })
  it("reads only /etc/machine-id with cancellable UTF-8 file IO", async () => {
    const read = vi.fn(async () => "0123456789abcdef0123456789abcdef\n")
    expect(await new LinuxMachineIdReader(read).read()).toEqual({
      platform: "linux",
      machineId: "0123456789abcdef0123456789abcdef\n",
    })
    expect(read).toHaveBeenCalledExactlyOnceWith("/etc/machine-id", {
      encoding: "utf8",
      signal: expect.any(AbortSignal),
    })
  })
  it("does not query another Linux source after a permission failure", async () => {
    const read = vi.fn(async () => {
      throw new Error(`EACCES ${raw}`)
    })
    await expect(new LinuxMachineIdReader(read).read()).rejects.toThrow("DEVICE_ID_UNAVAILABLE")
    expect(read).toHaveBeenCalledTimes(1)
  })
  it("waits out a slow read and aborts a stuck Linux read at the twenty-second deadline", async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    let settled = false
    const read = new LinuxMachineIdReader(async (_path, options) => {
      signal = options.signal
      return new Promise(() => {})
    })
      .read()
      .catch((error: unknown) => error)
      .finally(() => (settled = true))
    await vi.advanceTimersByTimeAsync(19_999)
    expect(settled).toBe(false)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await read).toMatchObject({ message: "DEVICE_ID_UNAVAILABLE" })
    expect(signal?.aborted).toBe(true)
  })
  it("rejects missing/duplicate macOS identifiers without reflecting command output", async () => {
    for (const output of [
      "",
      `"OtherUUID" = "${raw}"`,
      `"IOPlatformUUID" = "${raw}"\n"IOPlatformUUID" = "${raw}"`,
    ]) {
      await expect(new MacOsMachineIdReader(async () => output).read()).rejects.toThrow(
        "DEVICE_ID_UNAVAILABLE",
      )
    }
  })
  it("rejects unsupported platforms without invoking a fallback", async () => {
    await expect(createPlatformMachineIdReader("freebsd").read()).rejects.toThrow(
      "DEVICE_ID_UNAVAILABLE",
    )
  })
  it("uses execFile without a shell, caps output and kills after twenty seconds", async () => {
    processFixture.exec.mockImplementationOnce((_file, _args, options, callback) => {
      expect(options).toEqual({
        encoding: "utf8",
        timeout: 20_000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
        shell: false,
      })
      callback(null, raw, "")
    })
    expect(await runMachineIdCommand("/usr/sbin/ioreg", ["-rd1"])).toBe(raw)
  })
  it("does not reflect child-process stdout/stderr or execution errors", async () => {
    processFixture.exec.mockImplementationOnce((_file, _args, _options, callback) => {
      callback(Object.assign(new Error(raw), { stdout: raw, stderr: raw }), raw, raw)
    })
    const error: unknown = await runMachineIdCommand("/usr/sbin/ioreg", ["-rd1"]).catch(
      (value: unknown) => value,
    )
    expect(error).toMatchObject({ message: "DEVICE_ID_UNAVAILABLE" })
    expect(String(error) + JSON.stringify(error)).not.toContain(raw)
    expect(error).not.toHaveProperty("cause")
  })
})
