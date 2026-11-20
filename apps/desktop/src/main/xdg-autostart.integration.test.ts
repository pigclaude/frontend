// 用 Linux 的桌面启动器打开合成自启入口，验证路径和后台参数。

import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { expect, it, vi } from "vitest"
import { createXdgAutostart } from "./xdg-autostart"

const gio = "/usr/bin/gio"
const openbox = "/usr/lib/x86_64-linux-gnu/openbox-xdg-autostart"

for (const launcher of [
  { name: "GIO", executable: gio, args: (entry: string) => ["launch", entry] },
  { name: "Openbox", executable: openbox, args: () => ["OPENBOX"] },
]) {
  it.skipIf(process.platform !== "linux" || !existsSync(launcher.executable))(
    launcher.name + " 能启动路径含特殊字符的 AppImage，并完整传入后台参数",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "pigclaude-xdg-"))
      try {
        const executable = join(home, "PigClaude's 100%=$stable.AppImage")
        const config = join(home, "config space % $")
        const startup = createXdgAutostart(home, config, executable, "--pigclaude-autostart")
        await writeFile(executable, '#!/bin/sh\nprintf "%s\\n" "$@" > "${0}.args"\n', {
          mode: 0o700,
        })
        await startup.set(true)
        const entry = join(config, "autostart", "pigclaude-autostart.desktop")
        await promisify(execFile)(launcher.executable, launcher.args(entry), {
          env: {
            HOME: home,
            XDG_CONFIG_HOME: config,
            XDG_CONFIG_DIRS: join(home, "system-config"),
            PATH: process.env.PATH,
          },
          timeout: 5_000,
        })
        await vi.waitFor(
          async () => {
            expect(await readFile(executable + ".args", "utf8")).toBe("--pigclaude-autostart\n")
          },
          { timeout: 5_000 },
        )
      } finally {
        await rm(home, { recursive: true, force: true })
      }
    },
    15_000,
  )
}
