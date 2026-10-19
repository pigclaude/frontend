// 负责受信OAuth测试pipeline的幂等取消；只回收同步登记的runner/browser/web/fixture进程组。
import { spawn } from "node:child_process"
const delay = (ms) => new Promise((done) => setTimeout(done, ms))
function groupExists(child) {
  if (!child.pid) return false
  try {
    process.kill(-child.pid, 0)
    return true
  } catch (error) {
    if (error.code === "ESRCH") return false
    // macOS组正在退出时可能暂时EPERM；仍视为存在，必须等到明确ESRCH。
    if (error.code === "EPERM") return true
    throw new Error("OAUTH_TEST_PROCESS_GROUP_CHECK_FAILED")
  }
}
function signalGroup(child, signal) {
  if (!groupExists(child)) return
  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    // 退出中的组可能暂时EPERM；后续有界检查仍要求整个组确实消失。
    if (!["ESRCH", "EPERM"].includes(error.code)) throw new Error("OAUTH_TEST_PROCESS_STOP_FAILED")
  }
}
async function waitGroup(child, ms) {
  const deadline = Date.now() + ms
  while (groupExists(child) && Date.now() < deadline) await delay(25)
  return !groupExists(child)
}
async function stop(entry) {
  const { child, fixture, exited } = entry
  if (!child.pid) {
    await exited
    return
  }
  if (fixture && child.exitCode === null && child.signalCode === null) {
    child.stdin.end()
    // 让Rust先完成schema/密钥清理；leader退出也继续检查整个group。
    let timer
    await Promise.race([
      exited,
      new Promise((done) => {
        timer = setTimeout(done, 5000)
      }),
    ])
    clearTimeout(timer)
  }
  signalGroup(child, "SIGTERM")
  if (!(await waitGroup(child, 5000))) {
    signalGroup(child, "SIGKILL")
    if (!(await waitGroup(child, 2000))) throw new Error("OAUTH_TEST_PROCESS_STOP_TIMEOUT")
  }
  await exited
  if (fixture && child.exitCode !== 0) throw new Error("OAUTH_TEST_FIXTURE_CLEANUP_FAILED")
}
/** 在首个异步操作前安装信号处理，只登记自有spawn，并为全部取消/退出复用同一收尾承诺。 */
export function createOAuthLifecycle() {
  const controller = new AbortController()
  const entries = []
  let closing
  let cancelled
  let fail
  let unexpectedExit = false
  let browserReady = false
  let supervisionFailed = false
  const failure = new Promise((done) => {
    fail = done
  })
  const cancellation = new Promise((done) => {
    cancelled = done
  })
  const handlers = new Map()
  const lifecycle = {
    signal: controller.signal,
    cancelledBySignal: false,
    cancellation,
    /** 取消或常驻进程意外退出时固定失败，禁止继续登记新进程。 */
    throwIfCancelled() {
      controller.signal.throwIfAborted()
      if (unexpectedExit) throw new Error("OAUTH_TEST_CHILD_EXITED")
    },
    /** 同步登记独占process group，保证部分启动也进入收尾。 */
    spawn(command, args, options, role = "web") {
      lifecycle.throwIfCancelled()
      if (role === "runner" && !browserReady) {
        supervisionFailed = true
        throw new Error("OAUTH_TEST_BROWSER_SUPERVISION_REQUIRED")
      }
      return register(spawn(command, args, { ...options, detached: true }), role)
    },
    /** 只供顶层独占launch捕获使用；登记后代库实际spawn的browser，不按PPID补扫。 */
    registerBrowserProcess(child) {
      lifecycle.throwIfCancelled()
      return register(child, "browser")
    },
    /** 核对公开BrowserServer.process与同步登记对象一致后，允许受信runner连接。 */
    confirmBrowserProcess(child, finalize) {
      const entry = entries.find((value) => value.child === child && value.browser)
      if (!entry || !child.pid) {
        supervisionFailed = true
        throw new Error("OAUTH_TEST_BROWSER_REGISTRATION_FAILED")
      }
      entry.finalize = finalize
      browserReady = true
    },
    /** 监督能力失败不能被回收了最外组掩盖成成功。 */
    failBrowserSupervision() {
      supervisionFailed = true
    },

    /** 等待直接子进程与其残留后代，保留真实退出码。 */
    async wait(child) {
      const entry = entries.find((value) => value.child === child)
      const result = await lifecycle.pending(entry.exited)
      await stopOnce(entry)
      lifecycle.throwIfCancelled()
      return result.code
    },
    /** 取消时中断启动等待，结束后移除本次取消监听。 */
    pending(promise) {
      lifecycle.throwIfCancelled()
      return new Promise((done, reject) => {
        const abort = () => reject(new Error("OAUTH_TEST_CANCELLED"))
        controller.signal.addEventListener("abort", abort, { once: true })
        // failure先resolve，只有进入等待边界才转为固定错误，避免提前未处理reject。
        Promise.race([
          promise,
          failure.then(() => {
            throw new Error("OAUTH_TEST_CHILD_EXITED")
          }),
        ])
          .then(done, reject)
          .finally(() => {
            controller.signal.removeEventListener("abort", abort)
          })
      })
    },
    /** 幂等先停runner，再逐一回收全部自有组和fixture。 */
    shutdown() {
      if (closing) {
        if (supervisionFailed)
          return closing.then(() => {
            throw new Error("OAUTH_TEST_CLEANUP_FAILED")
          })
        return closing
      }
      controller.abort(new Error("OAUTH_TEST_CANCELLED"))
      closing = (async () => {
        let failed = false
        const ordered = [
          ...entries.filter((entry) => entry.runner).reverse(),
          ...entries.filter((entry) => !entry.runner).reverse(),
        ]
        for (const entry of ordered) {
          try {
            await stopOnce(entry)
          } catch {
            failed = true
          }
        }
        for (const entry of entries.filter((value) => value.finalize)) {
          let timer
          try {
            await Promise.race([
              entry.finalize(),
              new Promise((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error("OAUTH_TEST_BROWSER_CLOSE_TIMEOUT")),
                  5000,
                )
              }),
            ])
          } catch {
            failed = true
          } finally {
            clearTimeout(timer)
          }
        }
        if (failed || supervisionFailed) throw new Error("OAUTH_TEST_CLEANUP_FAILED")
      })()
      return closing
    },
    /** 收尾完成后移除本实例安装的信号监听。 */
    dispose() {
      for (const [signal, handler] of handlers) process.removeListener(signal, handler)
    },
  }
  function register(child, role) {
    child.stdin?.on("error", () => undefined)
    const exited = new Promise((done) => {
      const finish = (result) => {
        if (["web", "fixture", "browser"].includes(role) && !controller.signal.aborted) {
          unexpectedExit = true
          fail()
        }
        done(result)
      }
      child.once("error", () => finish({ code: 1 }))
      child.once("exit", (code, signal) => finish({ code: code ?? 1, signal }))
    })
    entries.push({
      child,
      exited,
      fixture: role === "fixture",
      runner: role === "runner",
      browser: role === "browser",
    })
    return child
  }
  function stopOnce(entry) {
    entry.stopping ??= stop(entry)
    return entry.stopping
  }
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]) {
    const handler = () => {
      if (!lifecycle.cancelledBySignal) {
        lifecycle.cancelledBySignal = true
        process.exitCode = code
        cancelled()
      }
      // 顶层finally等待同一promise；这里处理拒绝以免信号回调产生未捕获错误。
      void lifecycle.shutdown().catch(() => {
        process.exitCode = 1
      })
    }
    handlers.set(signal, handler)
    process.on(signal, handler)
  }
  return lifecycle
}
