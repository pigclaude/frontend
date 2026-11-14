// 负责验证页面刷新前的未保存确认：不保存就放行，取消就留在页面，保存成功后再刷新，保存失败不刷新。
import { describe, expect, it, vi } from "vitest"
import type { LeaveAnswer } from "./quit-confirmation"
import { guardReload, type ReloadablePage } from "./unsaved-guard"

function page(): ReloadablePage & {
  unload(): "unloaded" | "kept"
  reloads: number
} {
  let listener: ((event: { preventDefault(): void }) => void) | null = null
  const fake = {
    reloads: 0,
    on(_event: "will-prevent-unload", next: (event: { preventDefault(): void }) => void) {
      listener = next
      return fake
    },
    reload: () => {
      fake.reloads += 1
    },
    isDestroyed: () => false,
    unload(): "unloaded" | "kept" {
      let allowed = false
      listener?.({ preventDefault: () => (allowed = true) })
      return allowed ? "unloaded" : "kept"
    },
  }
  return fake
}

function guarded(answer: LeaveAnswer, saved = true, leaving = false) {
  const target = page()
  const save = vi.fn(async () => saved)
  const ask = vi.fn(() => answer)
  guardReload(target, { unsavedFiles: () => 2, saveFiles: save, ask, leaving: () => leaving })
  return { target, save, ask }
}

describe("guardReload", () => {
  it("lets the page go without asking once the user already chose to quit or close", () => {
    const { target, ask } = guarded("stay", true, true)

    expect(target.unload()).toBe("unloaded")
    expect(ask).not.toHaveBeenCalled()
  })

  it("lets the page unload when the user does not save", () => {
    const { target, save, ask } = guarded("leave")

    expect(target.unload()).toBe("unloaded")
    expect(ask).toHaveBeenCalledWith(2)
    expect(save).not.toHaveBeenCalled()
  })

  it("keeps the page when the user cancels", () => {
    const { target, save } = guarded("stay")

    expect(target.unload()).toBe("kept")
    expect(save).not.toHaveBeenCalled()
    expect(target.reloads).toBe(0)
  })

  it("saves first and reloads only after every file is saved", async () => {
    const saved = guarded("save")
    expect(saved.target.unload()).toBe("kept")
    await vi.waitFor(() => expect(saved.target.reloads).toBe(1))

    const failed = guarded("save", false)
    expect(failed.target.unload()).toBe("kept")
    await vi.waitFor(() => expect(failed.save).toHaveBeenCalledOnce())
    await Promise.resolve()
    expect(failed.target.reloads).toBe(0)
  })
})
