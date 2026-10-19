// 负责受信OAuth验收：顶层owner持有browser，runner/worker只连接并回收所有已登记资源。
import { startOwnedOAuthBrowser } from "./oauth-oidc-browser-owner.mjs"
import { createOAuthLifecycle } from "./oauth-oidc-process-lifecycle.mjs"
import { startOAuthLauncher, validateOAuthInfrastructure } from "./oauth-oidc-local-launcher.mjs"
const lifecycle = createOAuthLifecycle()
try {
  validateOAuthInfrastructure(process.env)
  const build = lifecycle.spawn(
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
    "build",
  )
  const built = await lifecycle.wait(build)
  if (built !== 0) {
    process.exitCode = built
    throw new Error("OAUTH_TEST_BUILD_FAILED")
  }
  const launcher = await startOAuthLauncher(process.env, lifecycle)
  const browser = await startOwnedOAuthBrowser(lifecycle)
  console.log(
    JSON.stringify({
      ready: true,
      homePort: new URL(launcher.home).port,
      adminPort: new URL(launcher.admin).port,
      layer: "local-mock-provider",
    }),
  )
  const child = lifecycle.spawn(
    "pnpm",
    ["exec", "playwright", "test", "tests/oauth-oidc-web-desktop.spec.ts"],
    {
      stdio: "inherit",
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        NO_COLOR: "1",
        OAUTH_TEST_BROWSER_WS: browser.endpoint,
        OAUTH_TEST_HOME: launcher.home,
        OAUTH_TEST_ADMIN: launcher.admin,
        OAUTH_TEST_CONTROL: launcher.control,
        OAUTH_TEST_CONTROL_SECRET: launcher.secret,
      },
    },
    "runner",
  )
  process.exitCode = await lifecycle.wait(child)
} catch {
  if (!lifecycle.cancelledBySignal) {
    console.error("OAUTH_TEST_E2E_FAILED")
    process.exitCode ||= 1
  }
} finally {
  try {
    await lifecycle.shutdown()
    console.log("OAUTH_TEST_OWNED_PROCESSES_STOPPED")
  } catch {
    console.error("OAUTH_TEST_CLEANUP_FAILED")
    process.exitCode = 1
  }
  lifecycle.dispose()
}
