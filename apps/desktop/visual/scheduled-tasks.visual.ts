// 在真实浏览器里核对定时任务编辑、已结束历史和会话跳转入口的页面布局。

import { expect, test } from "@playwright/test"
import { expectControlHeights } from "./control-heights"
import { installScheduledTasksPreview } from "./scheduled-tasks-fixture"

const screenshot = { threshold: 0.1, maxDiffPixels: 0, animations: "disabled" } as const

for (const theme of ["light", "dark"] as const) {
  test(`scheduled tasks main page ${theme}`, async ({ page }) => {
    await installScheduledTasksPreview(page)
    await page.clock.install({ time: new Date(2026, 10, 15, 14, 30) })
    await page.goto(`/?screen=chat-new&theme=${theme}`)
    await page.getByRole("button", { name: "定时任务", exact: true }).click()
    await expect(page.getByRole("button", { name: "定时任务", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    )
    await expect(page.getByRole("heading", { name: "定时任务模板" })).toBeVisible()
    await expect(page.getByRole("button", { name: "检查构建", exact: true })).toBeVisible()
    const awake = page.getByRole("switch", { name: "保持电脑唤醒" })
    await awake.click()
    await expect(awake).toBeChecked()
    await expect(page.locator(".toast")).toHaveCount(0, { timeout: 10_000 })
    await page.mouse.move(0, 0)
    await expect(page).toHaveScreenshot(`scheduled-tasks-main-${theme}.png`, screenshot)
    const create = page.getByRole("button", { name: "新建任务", exact: true })
    const refresh = page.locator(".schedules .page-head .btn-icon")
    await expectControlHeights(32, [create, refresh])
    await create.click()
    await expect(page.getByRole("heading", { name: "新建定时任务", exact: true })).toBeVisible()
    await expectControlHeights(36, [
      page.getByRole("textbox", { name: "标题", exact: true }),
      page.locator(".schedule-box"),
    ])
    await expectControlHeights(32, [page.getByRole("button", { name: "创建任务", exact: true })])
  })
}

test("scheduled task editor", async ({ page }) => {
  await installScheduledTasksPreview(page)
  await page.clock.install({ time: new Date(2026, 10, 15, 14, 30) })
  await page.goto("/?screen=scheduled-tasks&theme=light")
  await page.getByRole("button", { name: "检查构建", exact: true }).click()
  await expect(page.getByRole("heading", { name: "编辑定时任务", exact: true })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "指令" })).toHaveText(
    "检查主分支的构建和测试结果，汇总失败的步骤。",
  )
  await expectControlHeights(32, [page.getByRole("button", { name: "保存", exact: true })])
  await page.evaluate(() => document.fonts.ready)
  await expect(page).toHaveScreenshot("scheduled-task-editor.png", screenshot)
  await page.getByRole("combobox", { name: "频率" }).click()
  await page.getByRole("option", { name: "自定义", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "自定义重复" })
  await expectControlHeights(28, [
    dialog.getByRole("combobox", { name: "间隔单位" }),
    dialog.getByRole("spinbutton", { name: "间隔数值" }),
  ])
  await expectControlHeights(32, [dialog.getByRole("button", { name: "确定" })])
  await dialog.getByRole("combobox", { name: "间隔单位" }).click()
  await page.getByRole("option", { name: "分钟", exact: true }).click()
  await dialog.getByRole("spinbutton", { name: "间隔数值" }).fill("10")
  await dialog.getByRole("button", { name: "确定" }).click()
  await expect(page.getByRole("alert")).toContainText("至少为 15 分钟")
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled()
})

test("scheduled task run history", async ({ page }) => {
  await installScheduledTasksPreview(page)
  await page.clock.install({ time: new Date(2026, 10, 15, 14, 30) })
  await page.goto("/?screen=scheduled-tasks&theme=dark")
  await page.getByRole("button", { name: "检查构建", exact: true }).click()
  await page.getByRole("tab", { name: "历史", exact: true }).click()
  await expect(page.getByRole("tab", { name: "历史", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await expect(page.getByText("账号：工作 Max")).toBeVisible()
  await expect(page.getByText("项目目录不可用")).toBeVisible()
  await expect(page.getByRole("button", { name: "跳到会话" })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await expect(page).toHaveScreenshot("scheduled-task-history.png", screenshot)
})
