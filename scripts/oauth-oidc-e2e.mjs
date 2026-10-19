// 负责以单个owned launcher运行现有Playwright配置，并始终回收测试专属进程。
import { spawn } from "node:child_process"
import { startOAuthLauncher, validateOAuthInfrastructure } from "./oauth-oidc-local-launcher.mjs"
validateOAuthInfrastructure(process.env)
const build = spawn(
  "cargo",
  [
    "build",
    "--locked",
    "--manifest-path",
    "../backend/Cargo.toml",
    "--example",
    "oauth-live-fixture",
  ],
  { stdio: "inherit" },
)
if ((await new Promise((done) => build.once("exit", done))) !== 0) process.exit(1)
const launcher = await startOAuthLauncher()
try {
  console.log(
    JSON.stringify({
      ready: true,
      homePort: new URL(launcher.home).port,
      adminPort: new URL(launcher.admin).port,
      layer: "local-mock-provider",
    }),
  )
  const child = spawn(
    "pnpm",
    ["exec", "playwright", "test", "tests/oauth-oidc-web-desktop.spec.ts"],
    {
      stdio: "inherit",
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        NO_COLOR: "1",
        OAUTH_TEST_HOME: launcher.home,
        OAUTH_TEST_ADMIN: launcher.admin,
        OAUTH_TEST_CONTROL: launcher.control,
        OAUTH_TEST_CONTROL_SECRET: launcher.secret,
      },
    },
  )
  process.exitCode = (await new Promise((done) => child.once("exit", done))) ?? 1
} finally {
  await launcher.shutdown()
  for (const pid of launcher.pids) {
    let exists = false
    try {
      process.kill(pid, 0)
      exists = true
    } catch {
      /* 自有子进程已经退出。 */
    }
    if (exists) throw new Error("OAUTH_TEST_CHILD_STILL_RUNNING")
  }
  console.log("OAUTH_TEST_OWNED_PROCESSES_STOPPED")
}
