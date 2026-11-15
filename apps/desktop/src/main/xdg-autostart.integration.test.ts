// 用 Linux 的 GIO 启动合成桌面入口，验证可执行文件路径引用和后台参数。

import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { expect, it, vi } from "vitest"
import { createXdgAutostart } from "./xdg-autostart"

const gio = "/usr/bin/gio"

it.skipIf(process.platform !== "linux" || !existsSync(gio))(
  "GIO 能启动路径含空格、百分号和等号的 AppImage，并传入后台参数",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "pigclaude-xdg-gio-"))
    try {
      const executable = join(home, "PigClaude 100%=stable.AppImage")
      const config = join(home, "config")
      const startup = createXdgAutostart(home, config, executable, "--pigclaude-autostart")
      await writeFile(executable, '#!/bin/sh\nprintf "%s\\n" "$@" > "${0}.args"\n', { mode: 0o700 })
      await startup.set(true)
      const entry = join(config, "autostart", "pigclaude-autostart.desktop")
      await promisify(execFile)(gio, ["launch", entry], {
        env: { HOME: home, XDG_CONFIG_HOME: config, PATH: process.env.PATH },
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
