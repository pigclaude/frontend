// 负责在 jsdom 中操作真实 Radix Select 或 shadcn 搜索组合框，不绕过组件的选择事件。

import { act } from "react"
import { vi } from "vitest"
import { installCommandDom } from "./command-dom"

/** 打开下拉并按显示文字或选项 id 选中一项，完整经过组件的键盘事件处理。 */
export async function chooseSelect(trigger: HTMLElement, optionNameOrId: string): Promise<void> {
  const restore = installCommandDom()
  const searchable = trigger.getAttribute("data-slot") === "combobox-trigger"
  try {
    await act(async () => {
      trigger.focus()
      if (searchable) trigger.click()
      else trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })
    const options = searchable ? '[role="option"], .combobox-footer button' : '[role="option"]'
    const option = [...document.querySelectorAll<HTMLElement>(options)].find(
      (item) => item.id === optionNameOrId || item.textContent?.trim() === optionNameOrId,
    )
    if (!option) throw new Error(`下拉选项不存在：${optionNameOrId}`)
    await act(async () => {
      if (searchable) option.click()
      else option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })
    if (searchable) {
      await act(async () => {
        await vi.waitFor(() => {
          const expected = document.getElementById(`${trigger.id}-custom`) ?? trigger
          if (document.activeElement !== expected) throw new Error("组合框关闭后的焦点尚未恢复")
        })
      })
    }
  } finally {
    restore()
  }
}
