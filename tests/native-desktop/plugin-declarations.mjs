// 在实际 Electron 输入框用合成插件验证用户命令的纯文本插入和即时撤销。
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect } from "@playwright/test"

/** 用命令面板和斜杠菜单操作同一个临时插件，保留草稿且不会发送。 */
export async function verifyPluginDeclarations(page, userData, mod) {
  const id = "native-declaration"
  const root = join(userData, "fixture-capability-declaration")
  const label = "插入合成声明文字"
  const slash = "/pcfixture"
  const configured = "合成声明"
  const text = "<b>" + configured + "</b>"
  const message = "能力调用已完成"
  await mkdir(root)
  await Promise.all([
    writeFile(
      join(root, "pigclaude-plugin.json"),
      JSON.stringify({
        apiVersion: 1,
        id,
        name: "合成声明式插件",
        version: "1.0.0",
        pigclaudeVersion: "*",
        entry: "index.mjs",
        permissions: ["composer-insert", "storage", "notifications", "workspace-read"],
        settings: [{ key: "draft", type: "text", label: "草稿文字" }],
        commands: [{ id: "compose", title: label, slash }],
      }),
    ),
    writeFile(
      join(root, "index.mjs"),
      [
        "export default async (operation, { settings }, api) => {",
        '  if (operation !== "command:compose" || api.workspace || api.accounts || api.sessions)',
        "    throw new Error()",
        '  const visits = (await api.storage.get("visits")) ?? 0',
        '  await api.storage.set("visits", visits + 1)',
        "  if (visits === 0 && !(await api.notifications.show(" + JSON.stringify(message) + ")))",
        "    throw new Error()",
        '  if (!(await api.composer.insert("<b>" + settings.draft + "</b>"))) throw new Error()',
        "}",
      ].join("\n"),
    ),
  ])
  await page.evaluate(
    async ({ path, text }) => {
      const plugins = window.pigclaude.capabilityPlugins
      const disclosure = await plugins.prepare({ kind: "directory", path })
      const installed = await plugins.confirm(disclosure.confirmationId)
      const { manifest, revision } = await plugins.setEnabled(installed.manifest.id, true)
      await plugins.setSetting({ pluginId: manifest.id, revision }, "draft", text)
    },
    { path: root, text: configured },
  )

  const composer = page.getByLabel("给 agent 的消息", { exact: true })
  const palette = page.getByRole("dialog", { name: "行动" })
  try {
    await composer.fill("原来的草稿")
    await composer.press("End")
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press(mod + "+k")
    await palette.getByPlaceholder("搜索或执行命令…").fill(label)
    await palette.getByRole("option", { name: label, exact: true }).click()
    await expect(composer).toContainText(text)
    await expect(composer).toContainText("原来的草稿")
    await expect(composer.locator("b")).toHaveCount(0)
    await expect(
      page.getByText("插件「合成声明式插件」 · " + message, { exact: true }),
    ).toBeVisible()

    await composer.fill("")
    await page.keyboard.type(slash)
    const option = page.locator(".suggest-panel").getByRole("option").filter({ hasText: slash })
    await option.click()
    await expect(composer).toHaveText(text)

    await page.evaluate((id) => window.pigclaude.capabilityPlugins.setEnabled(id, false), id)
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press(mod + "+k")
    await palette.getByPlaceholder("搜索或执行命令…").fill(label)
    await expect(palette.getByRole("option", { name: label, exact: true })).toHaveCount(0)
    await page.keyboard.press("Escape")
    await composer.fill("")
    await page.keyboard.type(slash)
    await expect(option).toHaveCount(0)
  } finally {
    await page.evaluate((id) => window.pigclaude.capabilityPlugins.uninstall(id, false), id)
    await composer.fill("")
  }
}
