// 负责在真实 Electron 主窗口核对加固：CSP 拦下 eval、内联和远程脚本，主窗口在沙箱里运行。
import assert from "node:assert/strict"
import { expect } from "@playwright/test"

const policyMessage = /Content Security Policy/i

/** 记下主窗口控制台里的 CSP 拦截，包括挂上监听之前已经缓存的消息。 */
export async function collectPolicyViolations(page, violations) {
  page.on("console", (message) => {
    if (policyMessage.test(message.text())) violations.push(message.text())
  })
  for (const message of await page.consoleMessages()) {
    if (policyMessage.test(message.text())) violations.push(message.text())
  }
}

/** 核对主窗口的 CSP 和沙箱；调用前的流程不能被 CSP 拦下任何东西。 */
export async function verifyRendererHardening(application, page, violations) {
  assert.deepEqual(violations, [])
  const policy = await page.evaluate(() => {
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]')
    const script = document.querySelector("script[src]")
    return {
      content: meta?.getAttribute("content") ?? null,
      beforeScripts:
        !!meta &&
        !!script &&
        (meta.compareDocumentPosition(script) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    }
  })
  assert.equal(policy.beforeScripts, true)
  assert.match(policy.content ?? "", /(^|; )script-src 'self'(;|$)/)
  const probes = await page.evaluate(async () => {
    const directives = new Set()
    document.addEventListener("securitypolicyviolation", (event) =>
      directives.add(event.effectiveDirective),
    )
    const refused = (run) => {
      try {
        run()
        return false
      } catch (error) {
        return error instanceof EvalError
      }
    }
    const evalRefused = refused(() => (0, eval)("1"))
    const functionRefused = refused(() => new Function("return 1")())
    const inline = document.createElement("script")
    inline.textContent = "window.pigclaudeInlineProbe = true"
    document.head.append(inline)
    const remoteLoaded = await new Promise((resolve) => {
      const remote = document.createElement("script")
      remote.src = "https://csp-probe.invalid/probe.js"
      remote.onload = () => resolve(true)
      remote.onerror = () => resolve(false)
      document.head.append(remote)
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    return {
      evalRefused,
      functionRefused,
      inlineRan: Reflect.get(window, "pigclaudeInlineProbe") === true,
      remoteLoaded,
      directives: [...directives].sort(),
    }
  })
  assert.deepEqual(probes, {
    evalRefused: true,
    functionRefused: true,
    inlineRan: false,
    remoteLoaded: false,
    directives: ["script-src", "script-src-elem"],
  })
  await expect.poll(() => violations.length).toBeGreaterThanOrEqual(4)
  const preferences = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) =>
      candidate.webContents.getURL().endsWith("/renderer/index.html"),
    )
    const current = window?.webContents.getLastWebPreferences()
    return {
      sandbox: current?.sandbox,
      contextIsolation: current?.contextIsolation,
      nodeIntegration: current?.nodeIntegration,
    }
  })
  assert.deepEqual(preferences, { sandbox: true, contextIsolation: true, nodeIntegration: false })
  return { policy: policy.content, probes, preferences }
}
