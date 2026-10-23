// 负责支付健康条、渠道卡、密钥更换和撤销清理的行为回归。
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import type { PaymentSettingsView } from "@pigclaude/api/membership/payment-settings"
import { PaymentSettingsForm } from "./payment-settings-form"

const view: PaymentSettingsView = {
  revision: "7",
  enabled: true,
  gatewayUrl: "https://pay.test",
  pid: "merchant",
  keyConfigured: true,
  payTypes: ["alipay"],
  notifyBaseUrl: "https://home.test",
}
function mount(saved = view, onSave = vi.fn(async () => saved)) {
  return {
    ...render(
      <PaymentSettingsForm
        view={saved}
        canWrite
        busy={false}
        refreshFailed={false}
        onSave={onSave}
        onDirtyChange={() => {}}
      />,
    ),
    onSave,
  }
}
it.each([
  [view, "在线支付已启用"],
  [{ ...view, enabled: false }, "在线支付已关闭"],
  [{ ...view, keyConfigured: false }, "已启用但缺少密钥"],
  [{ ...view, payTypes: [] }, "已启用但未开放任何支付方式"],
] as const)("health banner reflects saved view %s", (saved, message) => {
  mount({ ...saved, payTypes: [...saved.payTypes] })
  expect(screen.getByText(message)).toBeTruthy()
  fireEvent.click(screen.getByRole("switch", { name: "启用支付" }))
  expect(screen.getByText(message)).toBeTruthy()
})
it("pay type cards toggle without exposed native checkbox", async () => {
  const { container, onSave } = mount()
  const control = screen.getByRole("switch", { name: "微信" })
  fireEvent.click(control)
  expect(control.getAttribute("aria-checked")).toBe("true")
  expect(
    [...container.querySelectorAll("input[type=checkbox]")].every(
      (input) =>
        (input as HTMLInputElement).tabIndex === -1 && input.getAttribute("aria-hidden") === "true",
    ),
  ).toBe(true)
  fireEvent.click(screen.getByRole("button", { name: "保存" }))
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        payTypes: ["alipay", "wxpay"],
      }),
    ),
  )
})
it("secret requires explicit replace and clears DOM on success", async () => {
  const { container } = mount()
  expect(container.querySelector("input[type=password]")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "更换" }))
  const input = screen.getByLabelText("密钥") as HTMLInputElement
  fireEvent.change(input, { target: { value: "temporary-secret" } })
  fireEvent.click(screen.getByRole("button", { name: "保存" }))
  await waitFor(() => expect(container.querySelector("input[type=password]")).toBeNull())
  expect(input.value).toBe("")
})
it("sticky bar appears only when dirty and undo clears all draft and secret DOM", () => {
  const { container } = mount()
  expect(screen.queryByText("有未保存的修改")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "更换" }))
  const input = screen.getByLabelText("密钥") as HTMLInputElement
  fireEvent.change(input, { target: { value: "discard-secret" } })
  fireEvent.change(screen.getByLabelText("PID"), { target: { value: "new" } })
  expect(screen.getByText("有未保存的修改").parentElement?.className).toContain("sticky")
  fireEvent.click(screen.getByRole("button", { name: "撤销" }))
  expect(input.value).toBe("")
  expect(container.querySelector("input[type=password]")).toBeNull()
  expect((screen.getByLabelText("PID") as HTMLInputElement).value).toBe("merchant")
  expect(screen.queryByText("有未保存的修改")).toBeNull()
})
it("unconfigured secret is immediate and unmount clears detached DOM", () => {
  const { unmount } = mount({ ...view, keyConfigured: false })
  const input = screen.getByLabelText("密钥") as HTMLInputElement
  fireEvent.change(input, { target: { value: "unmounted-secret" } })
  unmount()
  expect(input.value).toBe("")
})
it("failed save preserves replacement secret for retry", async () => {
  const save = vi.fn(async (): Promise<PaymentSettingsView> => {
    throw Error("failure")
  })
  mount(view, save)
  fireEvent.click(screen.getByRole("button", { name: "更换" }))
  const input = screen.getByLabelText("密钥") as HTMLInputElement
  fireEvent.change(input, { target: { value: "retry-secret" } })
  fireEvent.click(screen.getByRole("button", { name: "保存" }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  expect(input.value).toBe("retry-secret")
})
it.each(["resolve", "reject"])("old %s cannot clear successor owner secret", async (outcome) => {
  let resolve: (value: PaymentSettingsView) => void = () => {}
  let reject: (reason: Error) => void = () => {}
  const pending = new Promise<PaymentSettingsView>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  const onSave = vi.fn(() => pending)
  const props = {
    view,
    canWrite: true,
    busy: false,
    refreshFailed: false,
    onSave,
    onDirtyChange: () => {},
  }
  const mounted = render(<PaymentSettingsForm key="old" {...props} />)
  fireEvent.click(screen.getByRole("button", { name: "更换" }))
  const old = screen.getByLabelText("密钥") as HTMLInputElement
  fireEvent.change(old, { target: { value: "old-owner" } })
  fireEvent.click(screen.getByRole("button", { name: "保存" }))
  mounted.rerender(<PaymentSettingsForm key="new" {...props} />)
  expect(old.value).toBe("")
  fireEvent.click(screen.getByRole("button", { name: "更换" }))
  const current = screen.getByLabelText("密钥") as HTMLInputElement
  fireEvent.change(current, { target: { value: "new-owner" } })
  fireEvent.change(screen.getByLabelText("PID"), { target: { value: "new-pid" } })
  expect(current.value).toBe("new-owner")
  if (outcome === "resolve") resolve(view)
  else reject(Error("old"))
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
  expect(current.value).toBe("new-owner")
  expect(screen.getByText("有未保存的修改")).toBeTruthy()
})
it("turning a pay type off and on again leaves the form clean", () => {
  mount({ ...view, payTypes: ["alipay", "wxpay"] })
  const alipay = screen.getByRole("switch", { name: "支付宝" })
  fireEvent.click(alipay)
  expect(screen.getByText("有未保存的修改")).toBeTruthy()
  fireEvent.click(alipay)
  expect(alipay.getAttribute("aria-checked")).toBe("true")
  expect(screen.queryByText("有未保存的修改")).toBeNull()
})
