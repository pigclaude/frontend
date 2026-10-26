// 负责验证输入区只在提交成功后清空，失败、拒绝和抛错都保留草稿。

import { describe, expect, it, vi } from "vitest"
import { submitComposerText } from "./composer-submit"

describe("submitComposerText", () => {
  it("clears the editor after a successful submit", async () => {
    const clear = vi.fn()
    const submitted = await submitComposerText("改一下重试", async () => true, clear)

    expect(submitted).toBe(true)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it("keeps the draft when the submit is rejected", async () => {
    const clear = vi.fn()
    const submitted = await submitComposerText("改一下重试", () => false, clear)

    expect(submitted).toBe(false)
    expect(clear).not.toHaveBeenCalled()
  })

  it("keeps the draft when the submit throws", async () => {
    const clear = vi.fn()
    await expect(
      submitComposerText(
        "改一下重试",
        async () => {
          throw new Error("send failed")
        },
        clear,
      ),
    ).rejects.toThrow("send failed")
    expect(clear).not.toHaveBeenCalled()
  })

  it("does not submit or clear blank text", async () => {
    const clear = vi.fn()
    const submit = vi.fn(() => true)

    await expect(submitComposerText("   ", submit, clear)).resolves.toBe(false)
    expect(submit).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
  })
})
