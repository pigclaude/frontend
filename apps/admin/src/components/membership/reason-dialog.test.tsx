// 负责真实理由表单的旧默认提交语义与显式治理 Unicode 长度、原样理由边界。
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { ReasonDialog } from "./reason-dialog"
afterEach(cleanup)
function mount(maxCharacters?: number, preserveWhitespace = false) {
  const confirm = vi.fn()
  render(
    <ReasonDialog
      open
      title="操作"
      description="操作确认"
      confirmLabel="确认"
      pending={false}
      onOpenChange={() => {}}
      onConfirm={confirm}
      maxCharacters={maxCharacters}
      preserveWhitespace={preserveWhitespace}
    />,
  )
  return confirm
}
it("retains the legacy default native 200 UTF-16 input limit and trims confirmed membership reason", () => {
  const confirm = mount()
  const input = screen.getByLabelText("原因") as HTMLTextAreaElement
  expect(input.maxLength).toBe(200)
  fireEvent.change(input, { target: { value: "  会员原因  " } })
  fireEvent.click(screen.getByRole("button", { name: "确认" }))
  expect(confirm).toHaveBeenCalledWith("会员原因")
})
it("keeps the legacy confirmation rule based on nonblank trim without introducing a second codepoint gate", () => {
  const confirm = mount()
  fireEvent.change(screen.getByLabelText("原因"), { target: { value: "x".repeat(201) } })
  fireEvent.click(screen.getByRole("button", { name: "确认" }))
  expect(confirm).toHaveBeenCalledWith("x".repeat(201))
})
it("rejects a blank default reason rather than confirming a trimmed empty membership write", () => {
  const confirm = mount()
  fireEvent.change(screen.getByLabelText("原因"), { target: { value: "   " } })
  fireEvent.click(screen.getByRole("button", { name: "确认" }))
  expect(confirm).not.toHaveBeenCalled()
})
it("allows 500 Unicode characters for explicit governance while preserving original whitespace", () => {
  const confirm = mount(500, true)
  const reason = " " + "😀".repeat(498) + " "
  fireEvent.change(screen.getByLabelText("原因"), { target: { value: reason } })
  fireEvent.click(screen.getByRole("button", { name: "确认" }))
  expect(confirm).toHaveBeenCalledWith(reason)
})
it("rejects 501 explicit Unicode characters and permits correcting the same form to 500", () => {
  const confirm = mount(500, true)
  fireEvent.change(screen.getByLabelText("原因"), { target: { value: "😀".repeat(501) } })
  fireEvent.click(screen.getByRole("button", { name: "确认" }))
  expect(confirm).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText("原因"), { target: { value: "😀".repeat(500) } })
  fireEvent.click(screen.getByRole("button", { name: "确认" }))
  expect(confirm).toHaveBeenCalledWith("😀".repeat(500))
})
