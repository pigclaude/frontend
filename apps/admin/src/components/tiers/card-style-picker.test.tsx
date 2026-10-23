// 验证卡面选择器用中文名展示六种卡面，选中后仍回报卡面标识。
import { fireEvent, render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { CardStylePicker } from "./card-style-picker"

it("labels each card style in Chinese and reports the style id", () => {
  const onChange = vi.fn()
  render(<CardStylePicker value="azure" disabled={false} onChange={onChange} />)
  expect(screen.getAllByRole("radio").map((radio) => radio.textContent)).toEqual([
    "蓝",
    "金",
    "黑曜",
    "紫",
    "翠绿",
    "玫瑰",
  ])
  expect(screen.getByRole("radio", { name: "蓝" }).getAttribute("aria-checked")).toBe("true")
  fireEvent.click(screen.getByRole("radio", { name: "黑曜" }))
  expect(onChange).toHaveBeenCalledWith("obsidian")
})
