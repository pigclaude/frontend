// 在真实浏览器里核对定时任务编辑、已结束历史和会话跳转入口的页面布局。

import { expect, test } from "@playwright/test"
import { installScheduledTasksPreview } from "./scheduled-tasks-fixture"

const screenshot = { threshold: 0.1, maxDiffPixels: 0, animations: "disabled" } as const

test("scheduled task editor", async ({ page }) => {
  await installScheduledTasksPreview(page)
  await page.clock.install({ time: new Date(2026, 10, 15, 14, 30) })
  await page.goto("/?screen=scheduled-tasks&theme=light")
  await page
    .getByRole("article")
    .filter({ hasText: "检查主分支" })
    .getByRole("button", { name: "编辑任务" })
    .click()
  await expect(page.getByRole("heading", { name: "编辑任务", exact: true })).toBeVisible()
  await expect(page.getByLabel("提示词")).toHaveValue(
    "检查主分支的构建和测试结果，汇总失败的步骤。",
  )
  await page.evaluate(() => document.fonts.ready)
  await expect(page).toHaveScreenshot("scheduled-task-editor.png", screenshot)
  await page.getByRole("combobox", { name: "频率" }).click()
  await page.getByRole("option", { name: "自定义", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "自定义重复" })
  await dialog.getByRole("combobox", { name: "间隔单位" }).click()
  await page.getByRole("option", { name: "分钟", exact: true }).click()
  await dialog.getByRole("spinbutton", { name: "间隔数值" }).fill("10")
  await dialog.getByRole("button", { name: "确定" }).click()
  await expect(page.getByRole("alert")).toContainText("至少为 15 分钟")
  await expect(page.getByRole("button", { name: "保存任务" })).toBeDisabled()
})

test("scheduled task run history", async ({ page }) => {
  await installScheduledTasksPreview(page)
  await page.clock.install({ time: new Date(2026, 10, 15, 14, 30) })
  await page.goto("/?screen=scheduled-tasks&theme=dark")
  await page
    .getByRole("article")
    .filter({ hasText: "检查主分支" })
    .getByRole("button", { name: "运行记录" })
    .click()
  await expect(page.getByRole("heading", { name: "运行记录", exact: true })).toBeVisible()
  await expect(page.getByText("账号：工作 Max")).toBeVisible()
  await expect(page.getByText("项目目录不可用")).toBeVisible()
  await expect(page.getByRole("button", { name: "跳到会话" })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await expect(page).toHaveScreenshot("scheduled-task-history.png", screenshot)
})
