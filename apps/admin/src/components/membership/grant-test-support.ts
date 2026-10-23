// 负责会员 UI 测试局部 DOM 适配及真实选择器操作，不替代生产控件。
import { fireEvent, screen } from "@testing-library/react"
import { afterEach, beforeEach, vi } from "vitest"
/** 仅在调用测试内安装 cmdk 与 Radix 所需浏览器接口，结束后恢复。 */
export function setupPickerDom() {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView")
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    if (original) Object.defineProperty(Element.prototype, "scrollIntoView", original)
    else Reflect.deleteProperty(Element.prototype, "scrollIntoView")
  })
}
/** 使用实际 cmdk 与 Radix 选择用户和等级，保留可访问交互。 */
export async function fillGrant(remark: string) {
  fireEvent.click(screen.getByRole("button", { name: "选择用户" }))
  fireEvent.change(await screen.findByRole("combobox", { name: "搜索用户邮箱或 ID" }), {
    target: { value: "u" },
  })
  fireEvent.click(await screen.findByRole("option"))
  fireEvent.click(await screen.findByRole("radio", { name: /VIP/ }))
  fireEvent.change(screen.getByLabelText("操作备注"), { target: { value: remark } })
}
