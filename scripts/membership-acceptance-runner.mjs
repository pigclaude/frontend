// 负责在受信父进程读取0600浏览器能力后运行显式验收文件，禁止将能力写入日志。
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
const root = resolve(import.meta.dirname, "../..")
const runtime = JSON.parse(
  readFileSync(
    resolve(
      root,
      ".superpowers/sdd/2026-10-23-pigclaude-membership-experience/task-15-runtime.private.json",
    ),
    "utf8",
  ),
)
const result = spawnSync(
  "pnpm",
  ["--dir", "frontend", "exec", "playwright", "test", ...process.argv.slice(2)],
  {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      OAUTH_TEST_BROWSER_WS: runtime.browserWs,
      MEMBERSHIP_CAPTURE_REVISION: process.env.MEMBERSHIP_CAPTURE_REVISION,
    },
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  },
)
for (const stream of [result.stdout, result.stderr]) {
  let safe = stream ?? ""
  for (const value of [runtime.gatewayKey, runtime.secret, runtime.browserWs, "runtime-password"])
    if (value) safe = safe.replaceAll(value, "[REDACTED_FIXTURE_CAPABILITY]")
  process.stdout.write(safe)
}
process.exitCode = result.status ?? 1
