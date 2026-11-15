// 验证清单版本、能力和声明式内容均由宿主校验。

import { expect, it } from "vitest"
import { validateCapabilityPluginManifest } from "./capability-plugin-manifest"

const manifest = {
  apiVersion: 1,
  id: "com.example.report",
  name: "汇总",
  version: "1.2.0",
  pigclaudeVersion: ">=0.0.1 <0.1.0",
  entry: "dist/plugin.mjs",
  tools: [{ name: "summarize", description: "汇总", inputSchema: { type: "object" } }],
  permissions: ["network", "secrets"],
  networkDomains: ["Reports.Example.com"],
  settings: [{ key: "api_key", label: "密钥", type: "secret" }],
  commands: [{ id: "report", title: "生成摘要", slash: "/report" }],
  toolResultTemplates: [{ tool: "summarize", template: "{{summary}}" }],
}

it("规范并校验预构建工具以及设置、命令和结果模板", () => {
  expect(validateCapabilityPluginManifest(manifest, "0.0.5")).toMatchObject({
    ...manifest,
    networkDomains: ["reports.example.com"],
  })
  expect(() => validateCapabilityPluginManifest({ ...manifest, apiVersion: 2 }, "0.0.5")).toThrow(
    "PLUGIN_API_UNSUPPORTED",
  )
  expect(() => validateCapabilityPluginManifest(manifest, "0.1.0")).toThrow(
    "PLUGIN_VERSION_INCOMPATIBLE",
  )
})

it.each([
  { networkDomains: ["*.example.com"] },
  { networkDomains: ["https://example.com"] },
  { networkDomains: ["api.Anthropic.com"] },
  { networkDomains: ["files.Claude.ai"] },
  { networkDomains: ["EXAMPLE.com", "example.com"] },
  { permissions: ["secrets"] },
  { permissions: ["terminal"] },
  { entry: "../plugin.mjs" },
  { entry: "src/plugin.ts" },
  { settings: [{ ...manifest.settings[0], defaultValue: "明文秘密" }] },
  { commands: [{ ...manifest.commands[0], slash: "https://example.com" }] },
  { toolResultTemplates: [{ tool: "missing", template: "模板" }] },
  { tools: [{ ...manifest.tools[0], inputSchema: { type: "string" } }] },
  { tools: [manifest.tools[0], manifest.tools[0]] },
])("拒绝无效的声明 %j", (invalid) => {
  expect(() => validateCapabilityPluginManifest({ ...manifest, ...invalid }, "0.0.5")).toThrow(
    /PLUGIN_MANIFEST_INVALID|PLUGIN_DOMAIN_INVALID/,
  )
})
