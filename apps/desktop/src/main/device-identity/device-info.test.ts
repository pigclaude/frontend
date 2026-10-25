// 负责验证设备信息的电脑名回退、系统版本映射和上报文本清洗。
import { describe, expect, it, vi } from "vitest"
import { readDeviceInfo, type DeviceInfoDeps } from "./device-info"

const processFixture = vi.hoisted(() => ({ execFile: vi.fn() }))
vi.mock("node:child_process", () => ({ execFile: processFixture.execFile }))

function deps(overrides: Partial<DeviceInfoDeps> = {}): DeviceInfoDeps {
  return {
    platform: "darwin",
    systemVersion: () => "15.4",
    hostname: () => "lin-macbook.local",
    computerName: async () => null,
    readOsRelease: async () => null,
    appVersion: () => "1.3.0",
    ...overrides,
  }
}

describe("readDeviceInfo", () => {
  it("formats macOS version and prefers ComputerName", async () => {
    expect(await readDeviceInfo(deps({ computerName: async () => "Lin 的 MacBook Pro" }))).toEqual({
      name: "Lin 的 MacBook Pro",
      osVersion: "macOS 15.4",
      appVersion: "1.3.0",
    })
  })

  it("falls back to hostname without .local when scutil fails", async () => {
    const info = await readDeviceInfo(
      deps({
        computerName: async () => {
          throw new Error("scutil unavailable")
        },
      }),
    )
    expect(info.name).toBe("lin-macbook")
    expect((await readDeviceInfo(deps())).name).toBe("lin-macbook")
  })

  it("maps Windows builds to 10 and 11", async () => {
    const windows = (build: string) =>
      deps({ platform: "win32", systemVersion: () => `10.0.${build}` })
    expect((await readDeviceInfo(windows("19045"))).osVersion).toBe("Windows 10")
    expect((await readDeviceInfo(windows("22631"))).osVersion).toBe("Windows 11")
  })

  it("reads Linux distro from os-release or falls back", async () => {
    expect(
      await readDeviceInfo(
        deps({
          platform: "linux",
          hostname: () => "linux-box",
          readOsRelease: async () => 'NAME="Ubuntu"\nVERSION_ID="24.04"\n',
        }),
      ),
    ).toMatchObject({ name: "linux-box", osVersion: "Ubuntu 24.04" })
    for (const readOsRelease of [
      async () => null,
      async () => Promise.reject(new Error("missing")),
    ]) {
      expect((await readDeviceInfo(deps({ platform: "linux", readOsRelease }))).osVersion).toBe(
        "Linux",
      )
    }
  })

  it("truncates names and strips control characters", async () => {
    const info = await readDeviceInfo(
      deps({ computerName: async () => `  Li\u0000n\u0007 ${"名".repeat(70)}  ` }),
    )
    expect([...info.name]).toHaveLength(64)
    expect(info.name.startsWith("Lin 名")).toBe(true)
    expect(info.name).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/)
    expect((await readDeviceInfo(deps({ computerName: async () => "\u0000 \n" }))).name).toBe(
      "PigClaude 电脑",
    )
  })

  it("uses scutil with a fixed read-only command and a two-second limit", async () => {
    processFixture.execFile.mockImplementationOnce((file, args, options, callback) => {
      expect(file).toBe("scutil")
      expect(args).toEqual(["--get", "ComputerName"])
      expect(options).toMatchObject({ timeout: 2_000, shell: false })
      callback(null, "Lin 的 MacBook Pro\n", "")
    })
    expect((await readDeviceInfo(deps({ computerName: undefined }))).name).toBe(
      "Lin 的 MacBook Pro",
    )
  })
})
