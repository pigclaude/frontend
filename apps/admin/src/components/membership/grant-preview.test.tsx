// 验证授予预览的防抖、完整输入归属和关闭、权限、会话失效边界。
import { act, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, useLocation, useNavigate } from "react-router"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { GrantInput, GrantPreview } from "@pigclaude/api/membership/types"
import { useGrantPreview } from "./use-grant-preview"
import { adminSessionGeneration } from "@/lib/session-generation"
const preview = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api", () => ({ adminApi: { membership: { grants: { preview } } } }))
const input: GrantInput = {
  userId: "u1",
  tierId: "vip",
  duration: "1",
  durationUnit: "month",
  valueFen: "0",
  remark: "manual",
}
const result: GrantPreview = {
  tier: { code: "vip", name: "VIP", level: 1 },
  validUntil: "2026-12-01",
  voidedRemainingSeconds: "0",
  voidedValueFen: "0",
  convertedSeconds: "0",
}
function mount() {
  function Harness({ data, enabled }: { data: GrantInput; enabled: boolean }) {
    const location = useLocation()
    const navigate = useNavigate()
    const response = useGrantPreview(
      enabled ? data : null,
      JSON.stringify([location.key, enabled, data]),
    )
    return (
      <>
        <button onClick={() => void navigate("/new")}>换路由</button>
        <p>{response?.preview?.validUntil ?? response?.error ?? "无预览"}</p>
      </>
    )
  }
  function tree(data = input, enabled = true) {
    return (
      <MemoryRouter>
        <Harness data={data} enabled={enabled} />
      </MemoryRouter>
    )
  }
  const view = render(tree())
  return { ...view, change: (data = input, enabled = true) => view.rerender(tree(data, enabled)) }
}
async function tick(ms = 250) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  preview.mockResolvedValue(result)
})
afterEach(() => vi.useRealTimers())
it("does not start preview after session expires during debounce", async () => {
  mount()
  await tick(249)
  adminSessionGeneration.invalidate()
  await tick(1)
  expect(preview).not.toHaveBeenCalled()
})
it("debounces and binds preview to every grant field", async () => {
  const view = mount()
  await tick(249)
  expect(preview).not.toHaveBeenCalled()
  await tick(1)
  expect(preview).toHaveBeenCalledWith(input, expect.any(Function))
  for (const update of [
    { userId: "u2" },
    { tierId: "svip" },
    { duration: "3" },
    { durationUnit: "day" as const },
    { valueFen: "123" },
    { remark: "new" },
  ]) {
    const data = { ...input, ...update }
    view.change(data)
    expect(screen.getByText("无预览")).toBeTruthy()
    await tick()
    expect(preview).toHaveBeenLastCalledWith(data, expect.any(Function))
  }
})
it.each(["input", "closed-or-permission", "route", "session", "unmount"])(
  "ignores late preview after %s",
  async (mode) => {
    let resolve: (value: GrantPreview) => void = () => {}
    preview.mockReturnValueOnce(
      new Promise<GrantPreview>((accept) => {
        resolve = accept
      }),
    )
    const view = mount()
    await tick()
    if (mode === "input") view.change({ ...input, userId: "u2" })
    if (mode === "closed-or-permission") view.change(input, false)
    if (mode === "route") fireEvent.click(screen.getByText("换路由"))
    if (mode === "session") adminSessionGeneration.invalidate()
    if (mode === "unmount") view.unmount()
    await act(async () => resolve({ ...result, validUntil: "OLD-REPLY" }))
    expect(screen.queryByText("OLD-REPLY")).toBeNull()
  },
)
it.each(["input-roundtrip", "close-reopen", "session"])(
  "does not reuse completed preview after %s",
  async (mode) => {
    const view = mount()
    await tick()
    expect(screen.getByText(result.validUntil)).toBeTruthy()
    if (mode === "input-roundtrip") view.change({ ...input, duration: "2" })
    if (mode === "close-reopen") view.change(input, false)
    if (mode === "session") adminSessionGeneration.invalidate()
    view.change()
    expect(screen.queryByText(result.validUntil)).toBeNull()
    await tick(249)
    expect(preview).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(result.validUntil)).toBeNull()
    await tick(1)
    expect(preview).toHaveBeenCalledTimes(2)
    expect(screen.getByText(result.validUntil)).toBeTruthy()
  },
)
