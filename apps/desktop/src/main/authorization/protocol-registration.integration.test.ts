// 用 Linux 原生 GIO 验证用户级协议登记和带特殊字符的 AppImage 启动参数。

import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { expect, it, vi } from "vitest"
import { registerDesktopAuthorizationProtocol } from "./protocol-registration"

const gio = "/usr/bin/gio"

it.skipIf(process.platform !== "linux" || !existsSync(gio))(
  "首次登记后 GIO 能直接打开协议，并把完整回调传给 AppImage 路径",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "pigclaude-gio-protocol-"))
    const image = join(home, "PigClaude 100%=stable.AppImage")
    const callback = "pigclaude://authorize/callback?code=safe-fixture%2B&state=state-fixture"
    const env = {
      PATH: "/usr/bin:/bin",
      XDG_CONFIG_HOME: join(home, "config"),
      XDG_DATA_HOME: join(home, "data"),
      XDG_CONFIG_DIRS: join(home, "system-config"),
      XDG_DATA_DIRS: join(home, "system-data"),
      XDG_CURRENT_DESKTOP: "GNOME",
    }
    try {
      await writeFile(image, '#!/bin/sh\nprintf "%s\\n" "$@" > "$0.args"\n', { mode: 0o700 })
      await registerDesktopAuthorizationProtocol(
        { isPackaged: true, getPath: () => home, setAsDefaultProtocolClient: vi.fn() },
        "linux",
        env,
      )
      await promisify(execFile)(gio, ["open", callback], { env, timeout: 5_000 })
      await vi.waitFor(
        async () => expect(await readFile(image + ".args", "utf8")).toBe(callback + "\n"),
        { timeout: 5_000 },
      )
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  },
  15_000,
)
