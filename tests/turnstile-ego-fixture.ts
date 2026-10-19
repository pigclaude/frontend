// 负责完全本地的页面序列化夹具；不启动浏览器，也不模拟供应商验收成功。
import { runInNewContext } from "node:vm"
import type { ProofCommand, ProofReply } from "./turnstile-ego-proof"

/** 建立只实现测试所需 DOM/SDK 边界的本地执行环境。 */
export function proofFixture(
  pageUrl = "https://www.pigclaude.com/identity/login?interactionId=local-interaction&realm=User",
) {
  const initial = new URL(pageUrl)
  const location = {
    origin: initial.origin,
    pathname: initial.pathname,
    hostname: initial.hostname,
    search: initial.search,
    href: initial.href,
  }
  let interaction: unknown = {
    interactionId: initial.searchParams.get("interactionId") ?? "local-interaction",
    realm: initial.searchParams.get("realm") ?? "User",
    csrf: "local-csrf",
    phase: "login",
    registrationAllowed: true,
  }
  const paths: string[] = []
  let interactionStatus = 200
  let now = 1_000
  const nodes: object[] = []
  const removed: string[] = []
  const callbacks: ((proof: string) => void)[] = []
  const options: Record<string, unknown>[] = []
  let config: unknown = {
    enabled: true,
    provider: "turnstile",
    mode: "required",
    siteKey: "local-protocol-fixture-key",
  }
  let configRequests = 0
  const sdk = {
    ready: (callback: () => void) => callback(),
    render: (_element: object, option: Record<string, unknown>) => {
      options.push(option)
      callbacks.push(option.callback as (proof: string) => void)
      return `owned-widget-${callbacks.length}`
    },
    remove: (id: string) => removed.push(id),
  }
  const makeNode = () => ({
    style: { cssText: "" },
    textContent: "",
    append: (...children: object[]) => nodes.push(...children),
    remove: () => undefined,
  })
  const response = async (path: string) => {
    const url = new URL(path, location.origin)
    paths.push(url.pathname + url.search)
    if (url.pathname.startsWith("/v1/identity/interactions/"))
      return { status: interactionStatus, json: async () => structuredClone(interaction) }
    if (["/v1/auth/captcha", "/admin/v1/auth/captcha"].includes(url.pathname)) {
      configRequests++
      return { status: 200, json: async () => config }
    }
    throw new Error("未登记的本地夹具请求")
  }
  const sandbox = {
    window: { turnstile: sdk },
    location,
    URL,
    document: {
      documentElement: { classList: { contains: () => false } },
      createElement: makeNode,
      body: { prepend: (node: object) => nodes.push(node) },
      head: { append: (node: object) => nodes.push(node) },
    },
    performance: { now: () => now },
    fetch: response,
    setTimeout,
    clearTimeout,
    AbortSignal,
  }
  return {
    /** 同页面URL和请求上下文供当前interaction读取器使用。 */
    url: () => location.href,
    request: {
      get: async (url: string) => {
        const r = await response(url)
        return { status: () => r.status, json: r.json }
      },
    },
    paths,
    /** 模拟交互过期或设施不可用，验证清理不依赖网络。 */
    interactionResponseStatus: (status: number) => {
      interactionStatus = status
    },
    /** 改变服务器响应，不把查询参数自动当服务器事实。 */
    serverInteraction: (value: unknown) => {
      interaction = value
    },
    /** 模拟同页导航，用于旧proof不能跨interaction复用的回归。 */
    navigate: (value: string) => {
      const u = new URL(value)
      Object.assign(location, {
        origin: u.origin,
        pathname: u.pathname,
        hostname: u.hostname,
        search: u.search,
        href: u.href,
      })
    },
    callbacks,
    options,
    nodes,
    removed,
    /** 仅修改本地公开配置夹具，不访问服务器。 */
    configure: (value: unknown) => {
      config = value
    },
    /** 返回本地配置请求次数以验证拒绝顺序。 */
    requests: () => configRequests,
    /** 用可控单调时钟验证边界，不等待真实时间。 */
    advance: (milliseconds: number) => {
      now += milliseconds
    },
    /** 在没有模块闭包的 VM 中执行浏览器序列化函数。 */
    evaluate: async (
      fn: (argument: ProofCommand) => Promise<ProofReply>,
      argument: ProofCommand,
    ): Promise<ProofReply> =>
      runInNewContext(`(${fn.toString()})(argument)`, { ...sandbox, argument }),
  }
}
