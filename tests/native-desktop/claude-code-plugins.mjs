// 在真实 Electron 的已选项目中检查 Claude Code 插件披露与斜杠菜单。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { expect } from "@playwright/test"

/** 加载合成插件的命令与 skill，验证选择只插入相同的斜杠名称。 */
export async function verifyClaudeCodePluginMenu(page, workspace) {
  const id = "native-claude-fixture"
  const path = await mkdtemp(join(tmpdir(), "pigclaude-native-claude-plugin-"))
  const command = `/${id}:overview`
  const skill = `/${id}:lookup`
  const composer = page.getByLabel("给 agent 的消息", { exact: true })
  const menu = page.locator(".suggest-panel")
  let installed = false
  try {
    for (const [name, contents] of [
      [".claude-plugin/plugin.json", JSON.stringify({ name: id, hooks: {}, mcpServers: {} })],
      ["commands/overview.md", "只读取本机夹具。"],
      ["skills/lookup/SKILL.md", "---\nname: lookup\ndescription: 查询本机夹具\n---\n读取。\n"],
      [".lsp.json", "{}"],
    ]) {
      const file = join(path, name)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, contents)
    }
    const disclosure = await page.evaluate(
      (folder) => window.pigclaude.capabilityPlugins.prepare({ kind: "directory", path: folder }),
      path,
    )
    expect(disclosure.type).toBe("claude-code")
    expect(disclosure.manifest.ignoredComponents).toEqual(
      expect.arrayContaining(["hooks", "mcp", "lsp"]),
    )
    await page.evaluate(
      (key) => window.pigclaude.capabilityPlugins.confirm(key),
      disclosure.confirmationId,
    )
    installed = true

    const pluginCommands = () =>
      page.evaluate(
        async ({ cwd, id }) => {
          const commands = await window.pigclaude.session.commands({ workspace: cwd })
          return commands.map(({ text }) => text).filter((name) => name.startsWith(`/${id}:`))
        },
        { cwd: workspace, id },
      )
    await expect.poll(pluginCommands).toEqual([skill, command])
    await composer.fill("")
    await page.keyboard.type(`/${id}`)
    await expect(menu.getByText(command, { exact: true })).toBeVisible()
    await menu.getByText(skill, { exact: true }).click()
    await expect(composer).toContainText(skill)
    await composer.fill("")

    await page.evaluate((key) => window.pigclaude.capabilityPlugins.setEnabled(key, false), id)
    await expect.poll(pluginCommands).toEqual([])
    await page.keyboard.type(`/${id}`)
    await expect(menu).toBeVisible()
    await expect(menu.getByRole("option")).toHaveCount(0)
  } finally {
    if (installed)
      await page.evaluate((key) => window.pigclaude.capabilityPlugins.uninstall(key, false), id)
    if (await composer.count()) await composer.fill("")
    await rm(path, { recursive: true, force: true })
  }
}
