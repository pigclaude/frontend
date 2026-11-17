// 在浏览器里核对安装披露的权限、域名和工具，以及较长描述的排版。

import { expect, test } from "@playwright/test"
import { installPluginSettingsPreview } from "./plugin-settings-fixture"

test("local plugin installation disclosure", async ({ page }) => {
  await installPluginSettingsPreview(page)
  await page.goto("/?screen=plugins&theme=dark")
  await page.getByRole("button", { name: "添加插件" }).click()
  await page.getByRole("menuitem", { name: "从目录安装" }).click()
  const dialog = page.getByRole("dialog", { name: "安装披露" })
  await expect(dialog.getByText("读取工作区文件")).toBeVisible()
  await expect(dialog.getByText("docs.example.org")).toBeVisible()
  await expect(dialog.getByText("search_docs", { exact: true })).toBeVisible()
  const bounds = await dialog.boundingBox()
  const viewport = page.viewportSize()
  expect(bounds).not.toBeNull()
  expect(viewport).not.toBeNull()
  if (bounds && viewport) {
    expect(bounds.x + bounds.width / 2).toBeCloseTo(viewport.width / 2, 0)
    expect(bounds.y + bounds.height / 2).toBeCloseTo(viewport.height / 2, 0)
  }
  await page.evaluate(() => document.fonts.ready)
  await expect(page).toHaveScreenshot("plugin-install-disclosure-dark.png", {
    threshold: 0.1,
    maxDiffPixels: 0,
    animations: "disabled",
  })
})

test("host-rendered plugin settings", async ({ page }) => {
  await installPluginSettingsPreview(page, true)
  await page.goto("/?screen=plugins&theme=dark")
  await page.getByRole("button", { name: "打开 文档索引 的设置" }).click()
  const dialog = page.getByRole("dialog", { name: "文档索引 的设置" })
  await expect(dialog.getByLabel("索引名称")).toHaveValue("团队手册")
  await expect(dialog.getByLabel("索引密钥", { exact: true })).toHaveValue("")
  await expect(dialog.getByPlaceholder("密钥已保存")).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await expect(page).toHaveScreenshot("plugin-declarative-settings-dark.png", {
    threshold: 0.1,
    maxDiffPixels: 0,
    animations: "disabled",
  })
})

test("Claude Code plugin installation disclosure", async ({ page }) => {
  await installPluginSettingsPreview(page, false, {
    id: "release-guide",
    name: "发布手册",
    version: "1.4.0",
    commands: ["release-guide:notes"],
    skills: ["release-guide:checklist"],
    agents: ["release-guide:reviewer"],
    ignoredComponents: ["hooks", "mcp", "lsp"],
    skillExecution: [
      { name: "release-guide:checklist", inline: true, hooks: true, allowedTools: true },
    ],
  })
  await page.goto("/?screen=plugins&theme=dark")
  await page.getByRole("button", { name: "添加插件" }).click()
  await page.getByRole("menuitem", { name: "从目录安装" }).click()
  const dialog = page.getByRole("dialog", { name: "安装披露" })
  await expect(dialog.getByText("Claude Code 插件", { exact: true })).toBeVisible()
  await expect(dialog.getByText("插件 hooks, MCP 服务器, LSP 配置", { exact: true })).toBeVisible()
  await expect(
    dialog.getByText("! 内联命令 · 文件头 hooks · allowed-tools", { exact: true }),
  ).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await expect(page).toHaveScreenshot("claude-code-plugin-disclosure-dark.png", {
    threshold: 0.1,
    maxDiffPixels: 0,
    animations: "disabled",
  })
})
