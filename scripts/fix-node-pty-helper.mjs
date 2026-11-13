// 负责补齐 node-pty 的 macOS 预编译启动助手所需的执行权限。
import { chmodSync, existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

if (process.platform === "darwin") {
  const desktop = createRequire(new URL("../apps/desktop/package.json", import.meta.url))
  const packageRoot = dirname(desktop.resolve("node-pty/package.json"))
  for (const arch of ["darwin-arm64", "darwin-x64"]) {
    const helper = join(packageRoot, "prebuilds", arch, "spawn-helper")
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
}
