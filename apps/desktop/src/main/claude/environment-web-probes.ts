// 在无账号 Cookie 的独立上下文验证公开登录导航和所选请求的失效代理行为。

import { createServer, type Socket } from "node:net"
import { EnvironmentBrowserClient, record } from "./environment-browser-client"
import type { EnvironmentCheckItem, EnvironmentCheckTargets } from "./environment-check-model"
import { environmentCheckItem } from "./environment-policy"

/** 对公开登录页执行顶层导航，挑战与缺少登录控件均不自动通过。 */
export async function inspectClaudeNavigation(
  client: EnvironmentBrowserClient,
  targets: EnvironmentCheckTargets,
  mode: "system" | "bound",
): Promise<EnvironmentCheckItem> {
  return client.withPage(true, undefined, async (page) => {
    const response = await client.network(page, targets.claudeLogin, true, 15_000)
    let login = false
    if (response.status >= 200 && response.status < 300 && !response.error) {
      try {
        await client.waitForDocument(page)
        const dom = await client.evaluate(
          page,
          `({login:!!document.querySelector('input[type="email"],input[name="email"],button[data-testid="google-signin"]')})`,
        )
        login = record(dom) && dom.login === true
      } catch {
        /* 缺少稳定的登录控件不推测为成功。 */
      }
    }
    const sameHost = new URL(response.url).hostname === new URL(targets.claudeLogin).hostname
    const transport = !targets.claudeLogin.startsWith("https:") || response.secure
    const challenge = response.headers["cf-mitigated"] === "challenge" || response.status === 403
    const state =
      login && sameHost && transport && !response.fromCache && !response.fromServiceWorker
        ? "passed"
        : response.error && !challenge
          ? "failed"
          : "unknown"
    return environmentCheckItem("claude-navigation", mode, state, {
      expected: "公开登录页顶层访问成功，并出现登录控件",
      actual: `HTTP ${response.status || "未收到"}；${login ? "有登录控件" : challenge ? "遇到验证或挑战" : "未确认登录控件"}`,
      evidence: `无账号 Cookie 的独立页面；native 导航响应；${response.error ?? (transport ? "传输验证正常" : "缺少安全传输证据")}`,
      remedy:
        state === "passed"
          ? "由你继续完成真实登录"
          : "检查代理可达性；遇到挑战时重新检测，未确认前不提供授权入口",
    })
  })
}

/** 使用本轮独占且拒绝连接的 SOCKS 入口演练，不停止任何已有 Xray 或会话。 */
export async function inspectProxyFailure(
  client: EnvironmentBrowserClient,
  targets: EnvironmentCheckTargets,
  mode: "system" | "bound",
): Promise<EnvironmentCheckItem> {
  if (mode === "system")
    return environmentCheckItem("proxy-failure", mode, "info", {
      expected: "仅绑定代理时演练",
      actual: "本轮使用系统网络",
      evidence: "未创建应用内代理失效演练",
      remedy: "无需处理",
    })
  let connections = 0
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    connections++
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    socket.destroy()
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    })
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("无法创建本机诊断入口")
    return await client.withPage(true, `socks5://127.0.0.1:${address.port}`, async (page) => {
      const response = await client.network(page, targets.primaryIp, true)
      const failed =
        connections > 0 &&
        response.status === 0 &&
        response.error !== null &&
        response.error !== "probe_unavailable"
      const state = response.status > 0 ? "failed" : failed ? "passed" : "unknown"
      return environmentCheckItem("proxy-failure", mode, state, {
        expected: "诊断入口收到连接，所选请求明确失败且未取得 HTTP 响应",
        actual: `诊断连接 ${connections} 次；HTTP ${response.status || "未收到"}`,
        evidence: `本轮独占拒绝入口、独立临时上下文；${response.error ?? "收到响应"}；只覆盖所测请求`,
        remedy: state === "passed" ? "无需处理" : "检查浏览器的代理失效行为；超时不能代替失败证据",
      })
    })
  } finally {
    for (const socket of sockets) socket.destroy()
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
  }
}
