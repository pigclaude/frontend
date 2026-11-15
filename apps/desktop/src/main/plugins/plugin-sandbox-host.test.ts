// 验证能力插件按插件、版本和出口隔离，发生崩溃时退避，空闲后释放。
import { expect, it, vi } from "vitest"
import {
  PluginSandboxHost,
  type PluginSandboxContext,
  type PluginSandboxLaunch,
} from "./plugin-sandbox-host"
import { PluginSandboxError, type PluginSandboxSource } from "./plugin-sandbox-contract"

const source: PluginSandboxSource = {
  pluginId: "sample",
  revision: "fixture-1",
  egressId: "system",
  entry: "index.mjs",
  modules: { "index.mjs": "export default () => null" },
}
const call = { operation: "inspect", input: null } as const

it("复用同一出口，隔离其他出口，并在空闲时关闭两个上下文", async () => {
  vi.useFakeTimers()
  const opens = launcher()
  const host = new PluginSandboxHost(opens.launch, { idleMs: 20 })
  try {
    expect(await host.invoke(source, call)).toBe(1)
    expect(await host.invoke(source, call)).toBe(1)
    expect(await host.invoke({ ...source, egressId: "bound-route" }, call)).toBe(2)
    await vi.advanceTimersByTimeAsync(20)
    expect(opens.contexts.every((item) => item.context.close.mock.calls.length === 1)).toBe(true)
    expect(await host.invoke(source, call)).toBe(3)
  } finally {
    await host.dispose()
    vi.useRealTimers()
  }
})

it("崩溃结束工具调用，退避后才启动新上下文", async () => {
  vi.useFakeTimers()
  const opens = launcher()
  const host = new PluginSandboxHost(opens.launch, { restartDelayMs: 20 })
  try {
    expect(await host.invoke(source, call)).toBe(1)
    opens.contexts[0]?.crash()
    await expect(host.invoke(source, call)).rejects.toMatchObject({
      code: "PLUGIN_SANDBOX_BACKOFF",
    })
    await vi.advanceTimersByTimeAsync(20)
    expect(await host.invoke(source, call)).toBe(2)
  } finally {
    await host.dispose()
    vi.useRealTimers()
  }
})

it("排队中的请求被取消后不发送，调用失败后仍可执行后续工具", async () => {
  let release = () => {}
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const invoke = vi
    .fn<PluginSandboxContext["invoke"]>()
    .mockImplementationOnce(async () => {
      await blocked
      return "finished"
    })
    .mockRejectedValueOnce(new PluginSandboxError("PLUGIN_EXECUTION_FAILED"))
    .mockResolvedValueOnce("next")
  const host = new PluginSandboxHost(async () => ({ invoke, close: async () => {} }))
  const abort = new AbortController()
  try {
    const first = host.invoke(source, call)
    const skipped = host.invoke(source, call, { signal: abort.signal })
    abort.abort()
    await expect(skipped).rejects.toMatchObject({ code: "PLUGIN_CANCELLED" })
    release()
    expect(await first).toBe("finished")
    await expect(host.invoke(source, call)).rejects.toMatchObject({
      code: "PLUGIN_EXECUTION_FAILED",
    })
    expect(await host.invoke(source, call)).toBe("next")
    expect(invoke).toHaveBeenCalledTimes(3)
  } finally {
    release()
    await host.dispose()
  }
})

function launcher() {
  const contexts: Array<{
    context: { invoke: PluginSandboxContext["invoke"]; close: ReturnType<typeof vi.fn> }
    crash: () => void
  }> = []
  const launch: PluginSandboxLaunch = async (_source, crash) => {
    const id = contexts.length + 1
    const context = { invoke: async () => id, close: vi.fn(async () => {}) }
    contexts.push({ context, crash })
    return context
  }
  return { launch, contexts }
}
