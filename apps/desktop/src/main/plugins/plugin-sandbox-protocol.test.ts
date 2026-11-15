// 验证每个内存实例只能请求自己的包内资源，包文件不会覆盖受信的运行页。
import { expect, it } from "vitest"
import type { PluginSandboxSource } from "./plugin-sandbox-contract"
import { createPluginSandboxResources } from "./plugin-sandbox-protocol"

const source: PluginSandboxSource = {
  pluginId: "fixture",
  revision: "1",
  egressId: "system",
  entry: "runtime/supervisor.mjs",
  modules: { "runtime/supervisor.mjs": "export default () => 'plugin module'" },
}

it("保留宿主页及模块各自的地址，只接受来自该实例的静态请求", async () => {
  const same = createPluginSandboxResources(source, "first")
  const other = createPluginSandboxResources(source, "second")
  expect(same.permits(other.url)).toBe(false)
  expect(same.permits("http://127.0.0.1/")).toBe(false)
  expect(same.handle(new Request(same.entry, { method: "POST" })).status).toBe(404)
  const app = same.handle(new Request(same.url))
  expect(app.headers.get("content-type")).toContain("text/html")
  expect(await app.text()).toContain('src="/runtime/supervisor.mjs"')
  const entry = same.handle(new Request(same.entry))
  expect(entry.headers.get("content-type")).toContain("text/javascript")
  expect(await entry.text()).toBe("export default () => 'plugin module'")
})

it("不接受把外部文件路径当作包内模块", () => {
  expect(() =>
    createPluginSandboxResources(
      {
        ...source,
        entry: "../sample.mjs",
        modules: { "../sample.mjs": "export default () => null" },
      },
      "first",
    ),
  ).toThrow("PLUGIN_BUNDLE_INVALID")
})
