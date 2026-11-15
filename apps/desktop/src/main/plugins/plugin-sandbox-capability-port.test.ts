// 验证能力端口过滤未授权或重复的请求，并在调用结束后丢弃异步响应。
import { describe, expect, it, vi } from "vitest"
import { PluginSandboxCapabilityPort } from "./plugin-sandbox-capability-port"
import { pluginSandboxPayloadLimit, type PluginSandboxJson } from "./plugin-sandbox-contract"

describe("PluginSandboxCapabilityPort", () => {
  it("拒绝未授权方法与非 JSON 参数，同一个编号只执行一次", async () => {
    const controller = new AbortController()
    const request = vi.fn().mockResolvedValue("自己的值")
    const send = vi.fn()
    const port = new PluginSandboxCapabilityPort(
      { methods: ["storage.get"], request },
      controller.signal,
      send,
    )
    port.receive({ requestId: 1, method: "accounts.list", args: [] })
    port.receive({ requestId: 1, method: "storage.get", args: ["plugin-key"] })
    port.receive({ requestId: 2, method: "storage.get", args: [new Map()] })
    port.receive({ requestId: 3, method: "storage.get", args: ["你".repeat(200_000)] })
    port.receive({ requestId: 4, method: "storage.get", args: ["plugin-key"] })
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(4))
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "storage.get",
      ["plugin-key"],
      controller.signal,
    )
    for (const requestId of [1, 2, 3]) {
      expect(send).toHaveBeenCalledWith({ type: "capability-result", requestId, ok: false })
    }
    expect(send).toHaveBeenLastCalledWith({
      type: "capability-result",
      requestId: 4,
      ok: true,
      value: "自己的值",
    })
  })

  it("拒绝过大的结果并丢弃结束后的响应", async () => {
    const controller = new AbortController()
    let resolveLate: (value: PluginSandboxJson) => void = () => undefined
    const late = new Promise<PluginSandboxJson>((resolve) => {
      resolveLate = resolve
    })
    const request = vi
      .fn()
      .mockResolvedValueOnce("x".repeat(pluginSandboxPayloadLimit))
      .mockReturnValueOnce(late)
    const send = vi.fn()
    const port = new PluginSandboxCapabilityPort(
      { methods: ["workspace.readText"], request },
      controller.signal,
      send,
    )
    const payload = { method: "workspace.readText", args: ["readme.txt"] }
    port.receive({ ...payload, requestId: 1 })
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledExactlyOnceWith({
        type: "capability-result",
        requestId: 1,
        ok: false,
      }),
    )
    port.receive({ ...payload, requestId: 2 })
    controller.abort()
    resolveLate("旧调用的值")
    await late
    port.receive({ ...payload, requestId: 3 })
    expect(request).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("限制同时等待的能力请求，完成后允许新请求", async () => {
    let finish = () => {}
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    const request = vi.fn(async () => {
      await pending
      return true
    })
    const send = vi.fn()
    const port = new PluginSandboxCapabilityPort(
      { methods: ["storage.get"], request },
      new AbortController().signal,
      send,
    )
    for (let requestId = 1; requestId <= 33; requestId += 1)
      port.receive({ requestId, method: "storage.get", args: ["key"] })
    expect(request).toHaveBeenCalledTimes(32)
    expect(send).toHaveBeenCalledExactlyOnceWith({
      type: "capability-result",
      requestId: 33,
      ok: false,
    })
    finish()
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(33))
    port.receive({ requestId: 34, method: "storage.get", args: ["key"] })
    await vi.waitFor(() =>
      expect(send).toHaveBeenLastCalledWith({
        type: "capability-result",
        requestId: 34,
        ok: true,
        value: true,
      }),
    )
  })
})
