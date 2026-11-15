// 用合成通知器验证发送条件、点击跳转和失败时托盘反馈，不向系统发送通知。

import { expect, it, vi } from "vitest"
import { createBackgroundNotifications } from "./background-notifications"
import type { SessionEnvelope } from "../session/session-envelope"
import type { SessionHostEvent } from "../session/session-types"

function envelope(event: SessionHostEvent, sessionId = "session-a"): SessionEnvelope {
  return { version: 1, sessionId, seq: 8, at: "2026-11-15T00:00:00Z", event }
}

function harness(platform: NodeJS.Platform = "darwin") {
  const window = {
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => false,
    isFocused: () => true,
  }
  const openSession = vi.fn()
  const openWindow = vi.fn()
  const trayBadge = vi.fn()
  const shown: Array<{ title: string; body: string; click: () => void; failed: () => void }> = []
  const controller = createBackgroundNotifications({
    platform,
    window: () => window,
    show: (content, { click, failed }) => shown.push({ ...content, click, failed }),
    openSession,
    openWindow,
    trayBadge,
  })
  return { controller, window, shown, openSession, openWindow, trayBadge }
}

const completed = () =>
  envelope({ type: "turn-ended", turnId: "turn-a", status: "completed", errorCode: null })

it("只在主窗口不在前台时通知，并把点击送到该事件的会话", async () => {
  const { controller, window, shown, openSession } = harness()
  const describe = vi.fn(async () => null)
  await controller.session(completed(), describe)
  expect(shown).toHaveLength(0)
  expect(describe).not.toHaveBeenCalled()
  window.isFocused = () => false
  await controller.session(completed(), describe)
  expect(shown).toHaveLength(1)
  expect(shown[0]?.body).toBe("回合已完成")
  shown[0]?.click()
  expect(openSession).toHaveBeenCalledExactlyOnceWith("session-a")
})

it.each(["hidden", "minimized"] as const)("窗口状态为 %s 时也发送通知", async (state) => {
  const { controller, window, shown } = harness()
  window.isVisible = () => state !== "hidden"
  window.isMinimized = () => state === "minimized"
  await controller.session(completed(), async () => null)
  expect(shown).toHaveLength(1)
})

it("读取项目名期间窗口恢复前台时抑制通知", async () => {
  const { controller, window, shown } = harness()
  window.isFocused = () => false
  await controller.session(completed(), async () => {
    window.isFocused = () => true
    return null
  })
  expect(shown).toHaveLength(0)
})

it("失败通知不会泄漏首条提示词产生的标题、回复、失败原因或完整路径", async () => {
  const { controller, window, shown } = harness()
  window.isFocused = () => false
  const describe = vi.fn(async () => ({
    projectPath: "/private/folder/project",
    title: "private-prompt",
    titleSource: "auto" as const,
  }))
  for (const event of [
    { type: "turn-started", turnId: "turn-a", userText: "private-prompt" },
    { type: "delta", text: "private-reply", blockIndex: 0, thinking: false },
    { type: "error", code: "SDK_ERROR", message: "private-error" },
  ] satisfies SessionHostEvent[]) {
    await controller.session(envelope(event), describe)
  }
  expect(shown).toHaveLength(0)
  expect(describe).not.toHaveBeenCalled()
  await controller.session(
    envelope({ type: "turn-ended", status: "error", turnId: "turn-a", errorCode: "private-code" }),
    describe,
  )
  expect(shown.map(({ title, body }) => ({ title, body }))).toEqual([
    { title: "PigClaude", body: "回合失败 · project" },
  ])
})

it("跳过的运行支持指定会话，未建立会话时只唤回窗口", () => {
  const { controller, window, shown, openSession, openWindow } = harness()
  window.isFocused = () => false
  controller.announce({ kind: "skipped", sessionId: "session-b" })
  controller.announce({ kind: "skipped", sessionId: null })
  expect(shown.map(({ body }) => body)).toEqual(["已跳过", "已跳过"])
  shown[0]?.click()
  shown[1]?.click()
  expect(openSession).toHaveBeenCalledExactlyOnceWith("session-b")
  expect(openWindow).toHaveBeenCalledOnce()
})

it.each(["expired", "device_revoked", "signed_out", "verification_required"] as const)(
  "会员曾有效后才为 %s 发出一次全局通知，随后停放的回合不会重复提醒",
  async (loss) => {
    const { controller, window, shown, openWindow } = harness()
    window.isFocused = () => false
    controller.membership(loss)
    controller.membership("active")
    controller.membership("network_grace")
    expect(shown).toHaveLength(0)
    controller.membership(loss)
    controller.membership(loss)
    await controller.session(
      envelope({
        type: "turn-ended",
        status: "interrupted",
        turnId: "turn-a",
        errorCode: "MEMBERSHIP_REQUIRED",
      }),
      async () => null,
    )
    expect(shown.map(({ body }) => body)).toEqual(["会员已失效"])
    shown[0]?.click()
    expect(openWindow).toHaveBeenCalledOnce()
  },
)

it("网络宽限耗尽后按中断的一轮提醒", async () => {
  const { controller, window, shown } = harness()
  window.isFocused = () => false
  controller.membership("active")
  controller.membership("network_grace")
  controller.membership("error")
  await controller.session(
    envelope({
      type: "turn-ended",
      status: "interrupted",
      turnId: "turn-a",
      errorCode: "MEMBERSHIP_REQUIRED",
    }),
    async () => null,
  )
  expect(shown.map(({ body }) => body)).toEqual(["回合已中断"])
})

it("macOS 发送失败点亮托盘角标，聚焦后清除并忽略已经读过的迟到失败", async () => {
  const { controller, window, shown, trayBadge } = harness()
  window.isFocused = () => false
  await controller.session(completed(), async () => null)
  await controller.session(completed(), async () => null)
  shown[0]?.failed()
  expect(trayBadge).toHaveBeenCalledExactlyOnceWith(true)
  window.isFocused = () => true
  controller.windowFocused()
  shown[1]?.failed()
  expect(trayBadge.mock.calls).toEqual([[true], [false]])
})

it("其它平台发送失败不会动托盘；销毁后忽略旧通知点击", async () => {
  const { controller, window, shown, trayBadge, openSession } = harness("win32")
  window.isFocused = () => false
  await controller.session(completed(), async () => null)
  shown[0]?.failed()
  expect(trayBadge).not.toHaveBeenCalled()
  await controller.session(completed(), async () => null)
  controller.dispose()
  shown[1]?.click()
  expect(openSession).not.toHaveBeenCalled()
})
