// 通过 PigClaude 的公共包入口验证拷入的定时规则、自定义重复和运行历史组件。
// @vitest-environment jsdom

import { act, createElement, useState, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import userEvent, { PointerEventsCheckLevel } from "@testing-library/user-event"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { ScheduleRun } from "@pigclaude/ui-contracts"
import { LocaleProvider } from "@pigclaude/ui-primitives"
import { ScheduleHistory, ScheduleRuleField, type RuleValue } from "@pigclaude/ui-settings"
import { installCommandDom } from "../../test-support/command-dom"

let container: HTMLDivElement
let root: Root
let restoreDom: () => void
let previousPointerEvents: string

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  restoreDom = installCommandDom()
  previousPointerEvents = document.body.style.pointerEvents
  container = document.body.appendChild(document.createElement("div"))
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  // jsdom 没有弹层退出动画，直接恢复 Select 在 body 上的指针限制。
  document.body.style.pointerEvents = previousPointerEvents
  restoreDom()
  vi.unstubAllGlobals()
})

async function render(component: ReactElement): Promise<void> {
  await act(async () =>
    root.render(createElement(LocaleProvider, { locale: "zh-CN", children: component })),
  )
}

const weekly: RuleValue = { rule: { kind: "weekly", days: [1], time: "09:00" }, endsAt: null }

function RuleEditor({ changed }: { changed: (next: RuleValue | null) => void }) {
  const [value, setValue] = useState(weekly)
  return createElement(ScheduleRuleField, {
    value,
    onChange(next) {
      if (next) setValue(next)
      changed(next)
    },
  })
}

function findNamed(selector: string, name: string, scope: ParentNode = document) {
  return [...scope.querySelectorAll<HTMLElement>(selector)].find(
    (item) => (item.getAttribute("aria-label") ?? item.textContent?.trim()) === name,
  )
}

async function click(selector: string, name: string, scope?: ParentNode): Promise<void> {
  const item = await vi.waitFor(() => {
    const found = findNamed(selector, name, scope)
    if (!found) throw new Error(`找不到${name}`)
    return found
  })
  await act(async () => {
    // jsdom 不进行弹层的指针命中测试。这里验证真实组件收到交互后的行为。
    await userEvent.click(item, { pointerEventsCheck: PointerEventsCheckLevel.Never })
  })
}

async function choose(label: string, value: string): Promise<void> {
  await click('[role="combobox"]', label)
  await click('[role="option"]', value)
}

async function changeInput(scope: ParentNode, label: string, value: string): Promise<void> {
  const input = scope.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  if (!input || !setValue) throw new Error(`找不到${label}`)
  await act(async () => {
    setValue.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

it("每周规则必须选一天，并按用户选的星期和时分生成规则与预览", async () => {
  const changed = vi.fn()
  await render(createElement(RuleEditor, { changed }))
  expect(container.textContent).toContain("下次运行：")

  await click("button", "星期")
  await click('[role="menuitemcheckbox"]', "星期一")
  expect(changed).toHaveBeenLastCalledWith(null)
  expect(container.textContent).toContain("至少选一天。")
  expect(container.textContent).not.toContain("下次运行：")

  await click('[role="menuitemcheckbox"]', "星期五")
  await click("button", "星期")
  await choose("几点", "16")
  await choose("第几分", "30")
  expect(changed).toHaveBeenLastCalledWith({
    rule: { kind: "weekly", days: [5], time: "16:30" },
    endsAt: null,
  })
  expect(container.textContent).toContain("下次运行：")
})

it("自定义重复拒绝越界间隔，并交付每两周和本地结束日期", async () => {
  const changed = vi.fn()
  await render(createElement(RuleEditor, { changed }))
  await choose("频率", "自定义")
  const dialog = document.querySelector('[role="dialog"]')
  if (!dialog) throw new Error("未打开自定义重复对话框")

  for (const invalid of ["0", "201"]) {
    await changeInput(dialog, "间隔数值", invalid)
    expect(dialog.textContent).toContain("间隔要是 1 到 200 之间的整数。")
    expect(dialog.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
  }
  expect(changed).not.toHaveBeenCalled()

  await changeInput(dialog, "间隔数值", "2")
  await click("button", "星期一", dialog)
  await click("button", "星期五", dialog)
  await click('[role="radio"]', "指定日期", dialog)
  await changeInput(dialog, "结束日期", "2099-12-31")
  await click('button[type="submit"]', "确定", dialog)

  expect(changed).toHaveBeenCalledExactlyOnceWith({
    rule: { kind: "everyWeeks", every: 2, days: [5], time: "09:00", anchor: expect.any(String) },
    endsAt: new Date(2099, 11, 31, 23, 59, 59, 999).toISOString(),
  })
  expect(findNamed("button", "修改自定义重复")?.textContent).toContain("每 2 周的")
})

const successfulRun: ScheduleRun = {
  id: "success",
  scheduleId: "schedule",
  source: "schedule",
  status: "succeeded",
  threadId: "session",
  runId: "run",
  error: null,
  triggeredAt: "2026-11-06T01:00:00Z",
  finishedAt: "2026-11-06T01:01:35Z",
}

it("运行历史展示跳过原因，打开有结果的会话，删除记录后重读并按页加载", async () => {
  let runs: ScheduleRun[] = [
    successfulRun,
    {
      ...successfulRun,
      id: "skipped",
      source: "manual",
      status: "skipped",
      error: "THREAD_BUSY",
      runId: null,
      threadId: null,
      finishedAt: null,
    },
  ]
  const open = vi.fn()
  const remove = vi.fn(async (id: string) => {
    runs = runs.filter((run) => run.id !== id)
  })
  const load = vi.fn(async (_id: string, offset: number) => ({
    runs: offset === 0 ? runs : [{ ...successfulRun, id: "older" }],
    total: 43 + runs.length,
  }))
  await render(
    createElement(ScheduleHistory, {
      scheduleId: "schedule",
      revision: 0,
      onLoadRuns: load,
      onDeleteRun: remove,
      onOpenThread: open,
    }),
  )

  const [success, skipped] = container.querySelectorAll("tbody tr")
  if (!success || !skipped) throw new Error("未显示预期的两条运行记录")
  expect(success.textContent).toContain("成功")
  expect(skipped.textContent).toContain("手动")
  expect(skipped.textContent).toContain("已跳过")
  expect(skipped.textContent).toContain("会话正忙")
  expect(findNamed("button", "跳到会话", skipped)).toBeUndefined()
  await click("button", "跳到会话", success)
  expect(open).toHaveBeenCalledExactlyOnceWith("session")

  await click("button", "删除记录", skipped)
  expect(remove).toHaveBeenCalledExactlyOnceWith("skipped")
  expect(load.mock.calls).toEqual([
    ["schedule", 0, 20],
    ["schedule", 0, 20],
  ])
  expect(container.textContent).not.toContain("会话正忙")
  expect(container.textContent).toContain("第 1 / 3 页")

  await click("button", "下一页")
  expect(load).toHaveBeenLastCalledWith("schedule", 20, 20)
  expect(container.textContent).toContain("第 2 / 3 页")
})
