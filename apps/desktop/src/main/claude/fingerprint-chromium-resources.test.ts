// 验证桌面浏览器启动器按宿主系统和 CPU 架构选择随包内核，并拒绝错误架构。

import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { FingerprintChromiumAdapter } from "./fingerprint-chromium"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

it.each([
  ["darwin", "arm64", "fingerprint-chromium.app/Contents/MacOS/Chromium"],
  ["win32", "x64", "chrome.exe"],
  ["linux", "x64", "chrome"],
] as const)("在 %s/%s 上选择匹配架构的随包内核", async (platform, arch, relative) => {
  const root = await tempRoot()
  const binary = join(root, "pigclaude-runtime", "chromium", `${platform}-${arch}`, relative)
  await writeBinary(binary, platform, arch)
  const adapter = new FingerprintChromiumAdapter({
    profilesRoot: join(root, "profiles"),
    resourcesPath: root,
    hostPlatform: platform,
    hostArch: arch,
    env: {},
  })
  await expect(adapter.ensureAvailable()).resolves.toBe(binary)
})

it("拒绝路径标记正确但二进制架构不匹配的内核", async () => {
  const root = await tempRoot()
  const binary = join(root, "pigclaude-runtime", "chromium", "linux-x64", "chrome")
  await writeBinary(binary, "linux", "arm64")
  const adapter = new FingerprintChromiumAdapter({
    profilesRoot: join(root, "profiles"),
    resourcesPath: root,
    hostPlatform: "linux",
    hostArch: "x64",
    env: {},
  })
  await expect(adapter.ensureAvailable()).rejects.toMatchObject({ code: "BROWSER_MISSING" })
})

it("显式指定内核同样拒绝不匹配的架构", async () => {
  const root = await tempRoot()
  const binary = join(root, "chrome")
  await writeBinary(binary, "linux", "arm64")
  const adapter = new FingerprintChromiumAdapter({
    profilesRoot: join(root, "profiles"),
    binaryPath: binary,
    hostPlatform: "linux",
    hostArch: "x64",
    env: {},
  })
  await expect(adapter.ensureAvailable()).rejects.toMatchObject({ code: "BROWSER_MISSING" })
})

it.skipIf(process.platform !== "darwin" && process.platform !== "win32")(
  "无法读取 Electron 转译状态时，默认定位拒绝猜测架构",
  async () => {
    const root = await tempRoot()
    const previous = Object.getOwnPropertyDescriptor(process.versions, "electron")
    Object.defineProperty(process.versions, "electron", { value: "synthetic", configurable: true })
    try {
      const adapter = new FingerprintChromiumAdapter({
        profilesRoot: join(root, "profiles"),
        binaryPath: process.execPath,
      })
      await expect(adapter.ensureAvailable()).rejects.toMatchObject({ code: "BROWSER_MISSING" })
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.versions, "electron")
      else Object.defineProperty(process.versions, "electron", previous)
    }
  },
)

it.skipIf(process.platform !== "darwin")(
  "普通 Node 的 x64 进程无法证明是否转译时拒绝猜测宿主架构",
  async () => {
    const root = await tempRoot()
    const previous = Object.getOwnPropertyDescriptor(process, "arch")
    Object.defineProperty(process, "arch", { value: "x64", configurable: true })
    try {
      const adapter = new FingerprintChromiumAdapter({
        profilesRoot: join(root, "profiles"),
        binaryPath: process.execPath,
      })
      await expect(adapter.ensureAvailable()).rejects.toMatchObject({ code: "BROWSER_MISSING" })
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process, "arch")
      else Object.defineProperty(process, "arch", previous)
    }
  },
)

async function tempRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-browser-resources-"))
  directories.push(directory)
  return directory
}

async function writeBinary(path: string, platform: string, arch: string): Promise<void> {
  const bytes = Buffer.alloc(256)
  if (platform === "darwin") {
    bytes.writeUInt32LE(0xfeedfacf, 0)
    bytes.writeUInt32LE(arch === "arm64" ? 0x0100000c : 0x01000007, 4)
  } else if (platform === "win32") {
    bytes.write("MZ", 0)
    bytes.writeUInt32LE(128, 0x3c)
    bytes.write("PE\0\0", 128)
    bytes.writeUInt16LE(arch === "arm64" ? 0xaa64 : 0x8664, 132)
  } else {
    bytes.write("\x7fELF", 0)
    bytes.writeUInt8(2, 4)
    bytes.writeUInt8(1, 5)
    bytes.writeUInt16LE(arch === "arm64" ? 183 : 62, 18)
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
  await chmod(path, 0o755)
}
