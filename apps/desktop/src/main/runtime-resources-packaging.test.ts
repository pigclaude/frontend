// 验证打包拒绝缺少固定 PigBrowser 清单的占位资源，并核对安装资源目录约定。

import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { promisify } from "node:util"
import { expect, it } from "vitest"

const checkResources = createRequire(import.meta.url)(
  resolve(import.meta.dirname, "../../verify-runtime-resources.cjs"),
) as (context: unknown) => Promise<void>

it.each([
  ["darwin", 3, "arm64", "Chromium.app/Contents/MacOS/Chromium", "xray"],
  ["win32", 1, "x64", "browser/chrome.exe", "xray.exe"],
  ["linux", 1, "x64", "browser/chrome", "xray"],
] as const)(
  "%s 安装包拒绝只有可执行占位文件或非批准清单的资源",
  async (platform, arch, name, browser, xray) => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-package-resources-"))
    const root = join(directory, "runtime-assets", "pigclaude-runtime")
    const browserRoot = join(root, "pigbrowser", `${platform}-${name}`)
    const browserPath = join(browserRoot, browser)
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
      await expect(checkResources(context)).rejects.toThrow("PigBrowser 完整资源")
      await writeFile(join(browserRoot, "manifest.json"), "{}")
      await expect(checkResources(context)).rejects.toThrow("PigBrowser 完整资源")
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
    afterPack: "./prepare-packaged-runtime.cjs",
    afterAllArtifactBuild: "./verify-macos-dmg-resources.cjs",
    appImage: { executableArgs: [] },
    mac: { signIgnore: ["/Contents/Resources/pigclaude-runtime/pigbrowser(?:/|$)"] },
    extraResources: [
      { from: "runtime-assets/pigclaude-runtime", to: "pigclaude-runtime" },
      { from: "out/main/xray-watchdog.js", to: "xray-watchdog.cjs" },
      { from: "out/main/chunks", to: "chunks" },
    ],
  })
})

it.skipIf(process.platform === "win32")(
  "AppImage 入口原样交付协议参数并保留 Electron 沙箱",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-appimage-entry-"))
    const run = promisify(execFile)
    const launcher = resolve(import.meta.dirname, "../../linux-appimage-entry.sh")
    const callback = "pigclaude://authorize/callback?code=fixture&state=fixture"
    const env = { ...process.env, APPDIR: directory, APPIMAGE_EXIT_AFTER_INSTALL: "" }
    try {
      await writeFile(join(directory, "pigclaude"), '#!/bin/sh\nprintf "%s\\n" "$@"\n', {
        mode: 0o755,
      })
      await expect(
        run("sh", [launcher, callback, "--pigclaude-autostart"], { env }),
      ).resolves.toMatchObject({
        stdout: `${callback}\n--pigclaude-autostart\n`,
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)
