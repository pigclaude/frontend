// 用项目的实际调度服务和随包 Node 验证隔离 Windows 来宾机的时区切换。
import { execFile } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const require = createRequire(new URL("../../apps/desktop/package.json", import.meta.url))
const { build } = createRequire(require.resolve("electron-vite"))("esbuild")
const output = await mkdtemp(join(tmpdir(), "pigclaude-host-zone-probe-"))
try {
  const file = join(output, "probe.mjs")
  await build({
    entryPoints: [fileURLToPath(new URL("./host-scheduled-timezone.ts", import.meta.url))],
    outfile: file,
    platform: "node",
    target: "node24",
    bundle: true,
    format: "esm",
  })
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
  delete env.TZ
  const { stdout } = await promisify(execFile)(require("electron"), [file], {
    env,
    timeout: 100_000,
    windowsHide: true,
  })
  process.stdout.write(stdout)
} finally {
  await rm(output, { recursive: true, force: true })
}
