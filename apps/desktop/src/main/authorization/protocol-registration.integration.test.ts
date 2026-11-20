// 用原生 GIO 和 Openbox 的 xdg-open 验证 AppImage 协议登记与完整启动参数。

import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { expect, it, vi } from "vitest"
import { registerDesktopAuthorizationProtocol } from "./protocol-registration"

const gio = "/usr/bin/gio"
const openers = [
  { name: "GIO", executable: gio, args: ["open"], desktop: "GNOME", data: "data with spaces" },
  { name: "xdg-open", executable: "/usr/bin/xdg-open", args: [], desktop: "Openbox", data: "data" },
]

for (const opener of openers) {
  it.skipIf(process.platform !== "linux" || !existsSync(gio) || !existsSync(opener.executable))(
    `首次登记后 ${opener.name} 向带特殊字符路径的 AppImage 传入完整回调`,
    async () => {
      const home = await mkdtemp(join(tmpdir(), "pigclaude-protocol-"))
      const image = join(home, "PigClaude 100%=O'Hare $stable.AppImage")
      const callback = "pigclaude://authorize/callback?code=safe-fixture%2B&state=state-fixture"
      const env = {
        PATH: "/usr/bin:/bin",
        APPIMAGE: image,
        BROWSER: "/bin/false",
        DISPLAY: ":99",
        XDG_CONFIG_HOME: join(home, "config"),
        XDG_DATA_HOME: join(home, opener.data),
        XDG_CONFIG_DIRS: join(home, "system-config"),
        XDG_DATA_DIRS: join(home, "system-data"),
        XDG_CURRENT_DESKTOP: opener.desktop,
      }
      try {
        await writeFile(image, '#!/bin/sh\nprintf "%s\\n" "$@" > "$0.args"\n', { mode: 0o700 })
        const nativeRegister = vi.fn()
        await registerDesktopAuthorizationProtocol(
          { isPackaged: true, getPath: () => home, setAsDefaultProtocolClient: nativeRegister },
          "linux",
          env,
        )
        expect(nativeRegister).not.toHaveBeenCalled()
        await promisify(execFile)(opener.executable, [...opener.args, callback], {
          env,
          timeout: 5_000,
        })
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
}
