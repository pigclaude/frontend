// 通过宿主通知入口核对真实插件标识的限频、纯文本文段和发送失败时的重试。

import { expect, it, vi } from "vitest"
import { CapabilityPluginNotices } from "./capability-plugin-notices"

it("按插件标识限频，重名插件互不影响，同一插件改名不能绕过间隔", () => {
  let time = 0
  const publish = vi.fn()
  const notices = new CapabilityPluginNotices(publish, () => time)

  expect(notices.show("release-notes", "提示", "第一条")).toBe(true)
  expect(notices.show("release-notes", "重命名", "重复")).toBe(false)
  expect(notices.show("issue-summary", "提示", "另一插件")).toBe(true)

  time = 4_999
  expect(notices.show("release-notes", "提示", "还未到间隔")).toBe(false)
  time = 5_000
  expect(notices.show("release-notes", "提示", "到达间隔")).toBe(true)
  expect(publish.mock.calls).toEqual([
    [{ pluginName: "提示", message: "第一条" }],
    [{ pluginName: "提示", message: "另一插件" }],
    [{ pluginName: "提示", message: "到达间隔" }],
  ])
})

it("只发送短的非空单行文本，清除方向控制符并将标签保留为文字", () => {
  const publish = vi.fn()
  const notices = new CapabilityPluginNotices(publish)

  expect(notices.show("", "插件", "没有有效标识")).toBe(false)
  expect(notices.show("notice", " \u202E", "没有有效名称")).toBe(false)
  expect(notices.show("notice", "插件", " \n\u0000")).toBe(false)
  expect(notices.show("notice", "长".repeat(121), "名称超限")).toBe(false)
  expect(notices.show("notice", "插件", "长".repeat(241))).toBe(false)
  expect(publish).not.toHaveBeenCalled()

  expect(notices.show("notice", "  合成\u202E插件\n ", "  <b>文档</b>\r\n已生成  ")).toBe(true)
  expect(publish).toHaveBeenCalledExactlyOnceWith({
    pluginName: "合成插件",
    message: "<b>文档</b> 已生成",
  })
})

it("窗口未接收或发送出错时允许同一插件稍后重试", () => {
  const publish = vi.fn<() => boolean>()
  publish.mockReturnValueOnce(false).mockImplementationOnce(() => {
    throw new Error("window closed")
  })
  publish.mockReturnValue(true)
  const notices = new CapabilityPluginNotices(publish, () => 0)

  expect(notices.show("notice", "插件", "窗口尚未就绪")).toBe(false)
  expect(notices.show("notice", "插件", "窗口已关闭")).toBe(false)
  expect(notices.show("notice", "插件", "窗口已打开")).toBe(true)
  expect(notices.show("notice", "插件", "重复")).toBe(false)
})
