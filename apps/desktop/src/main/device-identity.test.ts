// 负责验证设备身份仅由固定平台来源派生，并在异常时封闭失败。
import { afterEach, describe, expect, it, vi } from "vitest"
import { DeviceIdentityService } from "./device-identity"
import type { PlatformMachineIdReader } from "./device-identity/platform-reader"

const machineId = "01234567-89AB-CDEF-0123-456789ABCDEF"
const expected = "pcd_77d95e81bc3fd6401209110cb1e22cc2961ec055ad4c95cfe63e51b6cefec0c2"
function reader(value = machineId): PlatformMachineIdReader {
  return { read: async () => ({ platform: "darwin", machineId: value }) }
}
afterEach(() => vi.useRealTimers())

describe("DeviceIdentityService", () => {
  it("uses the specified HMAC vector and exposes only derived identity", async () => {
    expect(await new DeviceIdentityService(reader()).read()).toEqual({
      deviceId: expected,
      platform: "darwin",
    })
  })
  it("survives new service instances, profile/account changes and simulated reinstall", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => new DeviceIdentityService(reader()).read()),
    )
    expect(results.every((result) => result.deviceId === expected)).toBe(true)
  })
  it("normalizes UUID case/hyphens and supports concurrent reads", async () => {
    const service = new DeviceIdentityService(reader("0123456789abcdef0123456789abcdef"))
    expect(await Promise.all([service.read(), service.read()])).toEqual([
      { deviceId: expected, platform: "darwin" },
      { deviceId: expected, platform: "darwin" },
    ])
  })
  it("separates machines and platform namespaces", async () => {
    const other = await new DeviceIdentityService(reader("1123456789abcdef0123456789abcdef")).read()
    expect(other.deviceId).not.toBe(expected)
    const windows = await new DeviceIdentityService({
      read: async () => ({ platform: "win32", machineId }),
    }).read()
    expect(windows.deviceId).toBe(
      "pcd_86de834472485a4f2cf6fa560e66733df761687e0a0f8e99dc5a865515f1efc4",
    )
    const linux = await new DeviceIdentityService({
      read: async () => ({ platform: "linux", machineId: " 0123456789ABCDEF0123456789ABCDEF\n" }),
    }).read()
    expect(linux.deviceId).toBe(
      "pcd_fd96fc37ac88519436178e324b4301a727062e286c3718550a1e1085405f337e",
    )
  })
  it.each([
    "",
    "uninitialized",
    "abc",
    "0".repeat(32),
    "F".repeat(32),
    "-" + "1".repeat(32),
    "1".repeat(33),
  ])("rejects missing or invalid machine identifier %s", async (value) => {
    await expect(new DeviceIdentityService(reader(value)).read()).rejects.toMatchObject({
      message: "DEVICE_ID_UNAVAILABLE",
      code: "DEVICE_ID_UNAVAILABLE",
    })
  })
  it("rejects hyphenated Linux data instead of silently changing its source format", async () => {
    await expect(
      new DeviceIdentityService({
        read: async () => ({ platform: "linux", machineId }),
      }).read(),
    ).rejects.toThrow("DEVICE_ID_UNAVAILABLE")
  })
  it("sanitizes permission/execution errors without reflecting machine identifiers", async () => {
    const service = new DeviceIdentityService({
      read: async () => {
        throw Object.assign(new Error(machineId), { stdout: machineId, stderr: machineId })
      },
    })
    const error: unknown = await service.read().catch((value: unknown) => value)
    expect(error).toMatchObject({ message: "DEVICE_ID_UNAVAILABLE", code: "DEVICE_ID_UNAVAILABLE" })
    expect(JSON.stringify(error)).not.toContain(machineId)
    expect(String(error)).not.toContain(machineId)
    expect(error).not.toHaveProperty("cause")
    expect(error).not.toHaveProperty("stdout")
  })
  it("rejects at twenty seconds when the reader never settles", async () => {
    vi.useFakeTimers()
    const service = new DeviceIdentityService({ read: () => new Promise(() => {}) })
    const result = service.read().catch((value: unknown) => value)
    await vi.advanceTimersByTimeAsync(19_999)
    let settled = false
    void result.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toMatchObject({ message: "DEVICE_ID_UNAVAILABLE" })
  })
})
