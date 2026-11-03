// 验证安装包资源检查拒绝缺失的浏览器或 Xray，并将两者复制到启动器约定的资源目录。

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { expect, it } from "vitest"

const checkResources = createRequire(import.meta.url)(
  resolve(import.meta.dirname, "../../verify-runtime-resources.cjs"),
) as (context: unknown) => Promise<void>

it.each([
  ["darwin", 3, "arm64", "fingerprint-chromium.app/Contents/MacOS/Chromium", "xray"],
  ["win32", 1, "x64", "chrome.exe", "xray.exe"],
  ["linux", 1, "x64", "chrome", "xray"],
] as const)(
  "%s 安装包在两项运行资源齐备前拒绝打包",
  async (platform, arch, name, browser, xray) => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-package-resources-"))
    const root = join(directory, "runtime-assets", "pigclaude-runtime")
    const browserPath = join(root, "chromium", `${platform}-${name}`, browser)
    const xrayPath = join(root, "xray", `${platform}-${name}`, xray)
    const watchdogPath = join(directory, "out", "main", "xray-watchdog.js")
    const context = { electronPlatformName: platform, arch, packager: { projectDir: directory } }
    try {
      await expect(checkResources(context)).rejects.toThrow("缺少")
      await mkdir(dirname(browserPath), { recursive: true })
      await writeFile(browserPath, "synthetic")
      await expect(checkResources(context)).rejects.toThrow("缺少")
      await mkdir(dirname(xrayPath), { recursive: true })
      await writeFile(xrayPath, "synthetic")
      await expect(checkResources(context)).rejects.toThrow("缺少")
      await mkdir(dirname(watchdogPath), { recursive: true })
      await writeFile(watchdogPath, "synthetic")
      await expect(checkResources(context)).resolves.toBeUndefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

it("安装包资源目录与运行时解析目录一致", async () => {
  const config: unknown = JSON.parse(
    await readFile(resolve(import.meta.dirname, "../../electron-builder.json"), "utf8"),
  )
  expect(config).toMatchObject({
    beforePack: "./verify-runtime-resources.cjs",
    extraResources: [
      { from: "runtime-assets/pigclaude-runtime", to: "pigclaude-runtime" },
      { from: "out/main/xray-watchdog.js", to: "xray-watchdog.cjs" },
      { from: "out/main/chunks", to: "chunks" },
    ],
  })
})
