// 验证清单声明与转发共同使用的域名规范化及永久拒绝边界。

import { expect, it } from "vitest"
import { isProhibitedPluginDomain, normalizePluginNetworkDomain } from "./plugin-network-domains"

it("把大小写、IDNA 和绝对域名表示归为同一精确名称", () => {
  expect(normalizePluginNetworkDomain("BÜCHER.Example.")).toBe("xn--bcher-kva.example")
  expect(normalizePluginNetworkDomain("localhost")).toBe("localhost")
})

it.each([
  "https://fixture.test",
  "*.fixture.test",
  "fixture.test:443",
  "fixture.test/path",
  "127.0.0.1",
])("域名字段拒绝 %s", (value) => expect(normalizePluginNetworkDomain(value)).toBeNull())

it("永久拒绝供应商根域和子域，区分使用相同词语的其他域名", () => {
  expect(isProhibitedPluginDomain("Anthropic.Com.")).toBe(true)
  expect(isProhibitedPluginDomain("api.anthropic.com")).toBe(true)
  expect(isProhibitedPluginDomain("www.claude.ai")).toBe(true)
  expect(isProhibitedPluginDomain("claude.com")).toBe(true)
  expect(isProhibitedPluginDomain("assets.claudeusercontent.com")).toBe(true)
  expect(isProhibitedPluginDomain("claude.example")).toBe(false)
})
