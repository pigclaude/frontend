// 读取已安装应用的小图标，macOS 优先使用应用包声明的图标资源。

import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)
const cache = new Map<string, Promise<string | null>>()

type BundleInfo = {
  CFBundleIconFile?: unknown
  CFBundleIconName?: unknown
  CFBundleIcons?: {
    CFBundlePrimaryIcon?: { CFBundleIconFiles?: unknown; CFBundleIconName?: unknown }
  }
}

async function bundleIcon(location: string): Promise<string | null> {
  const { stdout } = await run(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", join(location, "Contents", "Info.plist")],
    { timeout: 3_000 },
  )
  const info = JSON.parse(stdout) as BundleInfo
  const primary = info.CFBundleIcons?.CFBundlePrimaryIcon
  const filenames = [
    info.CFBundleIconFile,
    info.CFBundleIconName,
    primary?.CFBundleIconName,
    ...(Array.isArray(primary?.CFBundleIconFiles) ? primary.CFBundleIconFiles : []),
  ]
  for (const name of filenames) {
    if (typeof name !== "string" || !name || basename(name) !== name) continue
    for (const file of name.endsWith(".icns") ? [name] : [name + ".icns", name]) {
      const path = join(location, "Contents", "Resources", file)
      if (!(await stat(path).catch(() => null))?.isFile()) continue
      const directory = await mkdtemp(join(tmpdir(), "pigclaude-app-icon-"))
      try {
        const output = join(directory, "icon.png")
        await run("/usr/bin/sips", ["-s", "format", "png", "-Z", "64", path, "--out", output], {
          timeout: 5_000,
        })
        return "data:image/png;base64," + (await readFile(output)).toString("base64")
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  }
  return null
}

/** 同一个安装位置只读一次。找不到应用包图标时使用系统提供的文件图标。 */
export async function openAppIcon(
  location: string,
  systemIcon: (path: string) => Promise<{ isEmpty(): boolean; toDataURL(): string }>,
): Promise<string | null> {
  if (!location) return null
  const saved = cache.get(location)
  if (saved) return saved
  const icon = (async () => {
    if (process.platform === "darwin" && location.endsWith(".app")) {
      const mac = await bundleIcon(location).catch(() => null)
      if (mac) return mac
    }
    const image = await systemIcon(location)
    return image.isEmpty() ? null : image.toDataURL()
  })().catch(() => null)
  cache.set(location, icon)
  return icon
}
