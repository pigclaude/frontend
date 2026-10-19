// 负责顶层owner独占启动并同步登记Playwright浏览器；worker只取得受限loopback连接能力。
import childProcess from "node:child_process"
let captureActive = false

/** 通过公开launchServer持有独占浏览器；原异常、WS控制地址和cause均不越过失败边界。 */
export async function startOwnedOAuthBrowser(owner, browserType) {
  if (process.env.DEBUG || process.env.PWDEBUG) {
    owner.failBrowserSupervision()
    throw new Error("OAUTH_TEST_BROWSER_DEBUG_ENV_NOT_ALLOWED")
  }
  if (captureActive) {
    owner.failBrowserSupervision()
    throw new Error("OAUTH_TEST_BROWSER_CAPTURE_BUSY")
  }
  captureActive = true
  const original = childProcess.spawn
  const captured = []
  let server
  let confirmed = false
  childProcess.spawn = (command, args, options) => {
    owner.throwIfCancelled()
    if (options?.detached !== true) {
      owner.failBrowserSupervision()
      throw new Error("OAUTH_TEST_BROWSER_GROUP_REQUIRED")
    }
    const child = original(command, args, options)
    owner.registerBrowserProcess(child)
    captured.push(child)
    return child
  }
  try {
    const chromium = browserType ?? (await import("@playwright/test")).chromium
    server = await chromium.launchServer({
      channel: "chromium",
      headless: true,
      host: "127.0.0.1",
      port: 0,
      timeout: 30000,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      env: Object.fromEntries(
        ["PATH", "HOME", "TMPDIR"]
          .filter((key) => typeof process.env[key] === "string")
          .map((key) => [key, process.env[key]]),
      ),
    })
    const child = server.process()
    if (!captured.includes(child) || !child?.pid) {
      owner.failBrowserSupervision()
      throw new Error("OAUTH_TEST_BROWSER_REGISTRATION_FAILED")
    }
    const endpoint = server.wsEndpoint()
    const url = new URL(endpoint)
    if (
      url.protocol !== "ws:" ||
      url.hostname !== "127.0.0.1" ||
      !url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname === "/"
    ) {
      owner.failBrowserSupervision()
      throw new Error("OAUTH_TEST_BROWSER_ENDPOINT_INVALID")
    }
    owner.throwIfCancelled()
    owner.confirmBrowserProcess(child, async () => {
      try {
        await server.close()
      } catch {
        throw new Error("OAUTH_TEST_BROWSER_CLOSE_FAILED")
      }
    })
    confirmed = true
    return { endpoint, process: child }
  } catch {
    if (!owner.cancelledBySignal) owner.failBrowserSupervision()
    throw new Error("OAUTH_TEST_BROWSER_START_FAILED")
  } finally {
    childProcess.spawn = original
    captureActive = false
    if (server && !confirmed) {
      let timer
      try {
        await Promise.race([
          server.close(),
          new Promise((done) => {
            timer = setTimeout(done, 5000)
          }),
        ])
      } catch {
        /* 原始Playwright异常不能输出控制地址。 */
      } finally {
        clearTimeout(timer)
      }
    }
  }
}
