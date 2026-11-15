// 用真实桌面桥立即运行一项合成任务，验证不存在的项目会生成可读取的跳过记录。

import assert from "node:assert/strict"
import { join } from "node:path"
import { expect } from "@playwright/test"

/** 仅操作验收配置中的本机任务，项目路径从未创建，会话入口不会执行提示词。 */
export async function verifyScheduledTasks(page, userData) {
  const projectPath = join(userData, "missing-scheduled-project")
  const task = await page.evaluate(async (projectPath) => {
    return window.pigclaude.scheduledTasks.create({
      projectPath,
      prompt: "合成定时任务的跳过检查",
      rule: { kind: "daily", time: "09:00" },
      endsAt: null,
      enabled: false,
      model: null,
      permissionMode: "default",
      accountId: null,
    })
  }, projectPath)
  assert.ok(task)
  try {
    const run = await page.evaluate((id) => window.pigclaude.scheduledTasks.runNow(id), task.id)
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const page = await window.pigclaude.scheduledTasks.runs(id, 0, 20)
          return page.runs[0]
        }, task.id),
      )
      .toMatchObject({
        id: run.id,
        status: "skipped",
        reason: "PROJECT_UNAVAILABLE",
        sessionId: null,
      })
  } finally {
    await page.evaluate((id) => window.pigclaude.scheduledTasks.remove(id), task.id)
  }
}
