// 在隔离的 Windows 运行器上核对随包 Node 能否感知系统时区变化。
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createRequire } from "node:module"
import { promisify } from "node:util"

assert.equal(process.platform, "win32")
const run = promisify(execFile)
const require = createRequire(new URL("../../apps/desktop/package.json", import.meta.url))
const electron = require("electron")
const saved = (await run("tzutil.exe", ["/g"])).stdout.trim()
const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
delete env.TZ
try {
  await run("tzutil.exe", ["/s", "UTC"])
  const program = [
    "const pick = () => new Date().getTimezoneOffset()",
    "const before = pick()",
    "require('node:child_process').execFileSync('tzutil.exe', ['/s', 'US Mountain Standard Time'])",
    "const after = pick()",
    "delete process.env.TZ",
    "console.log(JSON.stringify({ before, after, afterCacheRefresh: pick() }))",
  ].join("; ")
  const { stdout } = await run(electron, ["-e", program], { env, timeout: 15_000 })
  const fresh = await run(electron, ["-p", "new Date().getTimezoneOffset()"], {
    env,
    timeout: 15_000,
  })
  const result = { ...JSON.parse(stdout.trim()), freshProcess: Number(fresh.stdout.trim()) }
  assert.equal(result.before, 0)
  assert.equal(result.freshProcess, 420)
  console.log("WINDOWS_CLOCK", JSON.stringify(result))
  const capabilities = await run("powercfg.exe", ["/a"])
  console.log(capabilities.stdout.trim())
} finally {
  await run("tzutil.exe", ["/s", saved])
}
