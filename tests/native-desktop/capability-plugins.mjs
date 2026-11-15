// 在隔离的开发版 Electron 中核对能力插件安装、启停和卸载的真实 IPC。

import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

/** 用当轮临时目录内的合成模块执行安装流程，不调用插件工具。 */
export async function verifyCapabilityPlugins(page, userData) {
  const id = "native-fixture"
  const root = join(userData, "fixture-capability-provider")
  await mkdir(root)
  await Promise.all([
    writeFile(
      join(root, "pigclaude-plugin.json"),
      JSON.stringify({
        apiVersion: 1,
        id,
        name: "合成能力插件",
        version: "1.0.0",
        pigclaudeVersion: "*",
        entry: "index.mjs",
        tools: [{ name: "identify", description: "返回合成标记", inputSchema: { type: "object" } }],
      }),
    ),
    writeFile(join(root, "index.mjs"), 'export default () => ({ result: "fixture" })'),
  ])
  const reveal = await page.evaluate(async (path) => {
    const plugins = window.pigclaude.capabilityPlugins
    const { developerMode } = await plugins.status()
    if (!developerMode) throw new Error("源码运行态应提供目录安装")
    return plugins.prepare({ kind: "directory", path })
  }, root)
  assert.equal(reveal.manifest.id, id)
  assert.equal(reveal.manifest.tools[0]?.name, "identify")
  const installed = await page.evaluate(
    (confirmation) => window.pigclaude.capabilityPlugins.confirm(confirmation),
    reveal.confirmationId,
  )
  assert.equal(installed.manifest.id, id)
  assert.equal(installed.toolApproval, "always_ask")
  try {
    await page.evaluate(async (pluginId) => {
      const plugins = window.pigclaude.capabilityPlugins
      const present = (await plugins.list()).some((entry) => entry.manifest.id === pluginId)
      if (!present) throw new Error("未读到已安装插件")
      if ((await plugins.setEnabled(pluginId, false)).enabled) throw new Error("停用未生效")
      if (!(await plugins.setEnabled(pluginId, true)).enabled) throw new Error("启用未生效")
      const updated = await plugins.setToolApproval(pluginId, "follow_session")
      if (updated.toolApproval !== "follow_session") throw new Error("工具审批偏好保存失败")
    }, id)
  } finally {
    await page.evaluate(
      (pluginId) => window.pigclaude.capabilityPlugins.uninstall(pluginId, false),
      id,
    )
  }
  const remaining = await page.evaluate(() => window.pigclaude.capabilityPlugins.list())
  assert.equal(
    remaining.some((entry) => entry.manifest.id === id),
    false,
  )
}
