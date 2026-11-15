// 校验一次 Worker 调用的能力消息，只向仍然有效的调用返回有界 JSON。
import {
  pluginSandboxPayloadLimit,
  type PluginSandboxCapabilityScope,
  type PluginSandboxJson,
} from "./plugin-sandbox-contract"

type Reply = { type: "capability-result"; requestId: number } & (
  { ok: true; value: PluginSandboxJson } | { ok: false }
)

/** 将当前端口收到的请求限定在主进程为当次调用核准的方法和信号内。 */
export class PluginSandboxCapabilityPort {
  #lastRequestId = 0

  /** 响应通过原调用的端口发送，信号结束时丢弃挂起的响应。 */
  constructor(
    private readonly scope: PluginSandboxCapabilityScope,
    private readonly signal: AbortSignal,
    private readonly send: (reply: Reply) => void,
  ) {}

  /** 请求编号单调递增，重复、乱序或无效编号不触发能力。 */
  receive(data: Record<string, unknown>): void {
    const { requestId } = data
    if (
      this.signal.aborted ||
      typeof requestId !== "number" ||
      !Number.isSafeInteger(requestId) ||
      requestId <= this.#lastRequestId
    )
      return
    this.#lastRequestId = requestId
    void this.#dispatch(requestId, data).catch(() => undefined)
  }

  async #dispatch(requestId: number, { method, args }: Record<string, unknown>): Promise<void> {
    const selected = this.scope.methods.find((name) => name === method)
    const frame = { type: "capability-result" as const, requestId }
    let reply: Reply = { ...frame, ok: false }
    try {
      if (selected !== undefined && Array.isArray(args) && isBoundedJson(args)) {
        const value = await this.scope.request(selected, args, this.signal)
        if (isBoundedJson(value)) reply = { ...frame, ok: true, value }
      }
    } catch {
      // 不跨端口发送主进程异常或插件提供的字符串。
    }
    if (!this.signal.aborted) this.send(reply)
  }
}

function isBoundedJson(candidate: unknown): candidate is PluginSandboxJson {
  let remaining = pluginSandboxPayloadLimit
  function visit(value: unknown, depth: number): boolean {
    remaining -= typeof value === "string" ? value.length + 2 : 1
    if (remaining < 0 || depth > 64) return false
    if (value === null || typeof value === "string" || typeof value === "boolean") return true
    if (typeof value === "number") return Number.isFinite(value)
    if (Array.isArray(value)) {
      for (const item of value) if (!visit(item, depth + 1)) return false
      return true
    }
    if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false
    for (const [key, item] of Object.entries(value)) {
      remaining -= key.length + 2
      if (!visit(item, depth + 1)) return false
    }
    return true
  }
  return (
    visit(candidate, 0) && Buffer.byteLength(JSON.stringify(candidate)) <= pluginSandboxPayloadLimit
  )
}
