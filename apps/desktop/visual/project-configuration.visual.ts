// 固定测试项目资料，覆盖项目报告与执行项确认的浅色和深色基线。
import { expect, test } from "@playwright/test"
import type { ProjectConfigurationReport } from "../src/project-configuration-contract"
import { installChatBridge, type ChatBridgeWindow } from "./chat-bridge"

const report: ProjectConfigurationReport = {
  workspace: "/Users/me/work/api",
  trust: "untrusted",
  hasProjectSettings: true,
  instructions: ["CLAUDE.md", ".claude/CLAUDE.md"],
  counts: { commands: 3, skills: 2, agents: 1 },
  hooks: [{ event: "SessionStart", kind: "command", command: "node ./scripts/check-project.js" }],
  environment: ["PROJECT_REGION", "SERVICE_TOKEN"],
  servers: [{ name: "project-search", command: "node" }],
  credentialScripts: [{ name: "apiKeyHelper", command: "./scripts/project-key" }],
  skillExecution: [{ name: "release", inline: true, hooks: false, allowedTools: true }],
  shadowedCommands: ["panel"],
  unreadable: [],
}

for (const theme of ["light", "dark"] as const) {
  test(`project configuration ${theme}`, async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 9, 26, 15, 0, 0) })
    await installChatBridge(page)
    await page.addInitScript((snapshot) => {
      const { install } = (window as unknown as ChatBridgeWindow).__chatBridge
      install({})
      if (!window.pigclaude) throw new Error("视觉用例缺少桌面桥")
      window.pigclaude.projectConfiguration = {
        report: async () => snapshot,
        prepare: async (_path, trusted) => ({ id: "verification", report: snapshot, trusted }),
        confirm: async () => snapshot,
      }
    }, report)
    await page.goto(`/?screen=chat-new&theme=${theme}&glass=0`)
    await page.evaluate(() => document.fonts.ready)
    const project = page.getByRole("button", { name: "api", exact: true })
    await project.click({ button: "right" })
    await page.getByRole("menuitem", { name: "项目配置" }).click()
    const card = page.getByRole("dialog", { name: "项目配置" })
    await expect(card.getByText("SERVICE_TOKEN")).toBeVisible()
    if (theme === "dark") await card.getByRole("button", { name: "启用项目设置与 MCP" }).click()
    await expect(card).toHaveScreenshot(`project-configuration-${theme}.png`, {
      animations: "disabled",
    })
  })
}
