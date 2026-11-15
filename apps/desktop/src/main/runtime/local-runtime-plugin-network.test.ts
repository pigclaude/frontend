// 验证真实运行时根据已选号而非偏好选择插件出口，错误上下文保持关闸。

import { expect, it } from "vitest"
import { account, harness, proxy } from "./local-runtime-fixtures"

const domains = { declaredDomains: ["localhost"], approvedDomains: ["localhost"] }
const signal = new AbortController().signal

it("以当前选择的账号分离插件出口，账号未选中或代理不可用时拒绝", async () => {
  const h = await harness({
    accounts: [
      account("fixture-direct", { proxyId: null }),
      account("fixture-proxied", { proxyId: "fixture-proxy" }),
      account("fixture-missing", { proxyId: "missing-proxy" }),
    ],
    proxies: [
      { ...proxy("fixture-proxy"), url: "http://fixture-user:fixture-password@127.0.0.1:1" },
    ],
  })
  try {
    await h.runtime.start()
    const daemon = h.daemons[0]
    if (!daemon) throw new Error("缺少假 daemon")
    const first = h.runtime.openSession({
      sessionId: "first",
      preferredAccountId: "fixture-direct",
    })
    h.runtime.openSession({ sessionId: "second", preferredAccountId: "fixture-proxied" })
    const system = await h.runtime.pluginNetwork(null, domains)
    await expect(h.runtime.pluginNetwork("first", domains)).rejects.toThrow(
      "PLUGIN_EGRESS_UNAVAILABLE",
    )
    daemon.options.onAccountSelected("first", "fixture-proxied", undefined)
    daemon.options.onAccountSelected("second", "fixture-direct", undefined)
    const proxied = await h.runtime.pluginNetwork("first", domains)
    const direct = await h.runtime.pluginNetwork("second", domains)
    expect(proxied.egressId).not.toBe(system.egressId)
    expect(direct.egressId).toBe(system.egressId)

    daemon.options.onAccountSelected("first", "fixture-missing", "fixture-proxied")
    await expect(h.runtime.pluginNetwork("first", domains)).rejects.toThrow(
      "PLUGIN_EGRESS_UNAVAILABLE",
    )
    expect((await proxied.forward(new Request("https://localhost:1/fixture"), signal)).type).toBe(
      "error",
    )
    first.close()
    await expect(h.runtime.pluginNetwork("first", domains)).rejects.toThrow(
      "PLUGIN_EGRESS_UNAVAILABLE",
    )
  } finally {
    await h.cleanup()
  }
})
