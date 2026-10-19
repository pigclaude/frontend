// 负责完全本地的页面序列化夹具；不启动浏览器，也不模拟供应商验收成功。
import { runInNewContext } from "node:vm"
import type { ProofCommand, ProofReply } from "./turnstile-ego-proof"

/** 建立只实现测试所需 DOM/SDK 边界的本地执行环境。 */
export function proofFixture(origin = "https://pigclaude.com") {
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
  const sandbox = {
    window: { turnstile: sdk },
    location: { origin, pathname: "/login", hostname: new URL(origin).hostname },
    document: {
      documentElement: { classList: { contains: () => false } },
      createElement: makeNode,
      body: { prepend: (node: object) => nodes.push(node) },
      head: { append: (node: object) => nodes.push(node) },
    },
    performance: { now: () => now },
    fetch: async () => {
      configRequests++
      return {
        status: 200,
        json: async () => config,
      }
    },
    setTimeout,
    clearTimeout,
    AbortSignal,
  }
  return {
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
