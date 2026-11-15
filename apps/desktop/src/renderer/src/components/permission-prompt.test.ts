// 负责验证权限询问卡片：正文按工具族显示命令或文件，选项带说明和编号，方向键与数字键能完成回答，
// 只有 SDK 给出建议时才出现“始终允许”。

// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LocaleProvider } from "@pigclaude/ui-primitives"
import type { SessionPermissionCard } from "../models/session-permissions"
import { PermissionPrompt } from "./permission-prompt"

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

function card(overrides: Partial<SessionPermissionCard> = {}): SessionPermissionCard {
  return {
    requestId: "permission-1",
    toolName: "Bash",
    input: { command: "pnpm test" },
    suggestions: [],
    blockedPath: null,
    subagent: null,
    status: "pending",
    requestedAt: "2026-11-14T01:00:00.000Z",
    resolvedAt: null,
    ...overrides,
  }
}

function options(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="option"]')]
}

async function render(request: SessionPermissionCard, onDecide = vi.fn()): Promise<void> {
  await act(async () =>
    root.render(
      createElement(LocaleProvider, {
        locale: "zh-CN",
        children: createElement(PermissionPrompt, { request, onDecide }),
      }),
    ),
  )
}

describe("permission prompt", () => {
  it("shows the browser operation and never offers to save its approval", async () => {
    const url = "http://127.0.0.1:5173/dev/path"
    await render(
      card({
        toolName: "mcp__pigclaude_workbench__browser_open",
        input: { url },
        browser: { kind: "open", url },
        suggestions: [{ index: 0, label: "browser_open", canSaveProject: true }],
      }),
    )
    const target = container.querySelector(".perm-prompt-target")
    expect(target?.textContent).toBe(url)
    expect(target?.querySelector("strong")?.textContent).toBe("http://127.0.0.1:5173")
    expect(options()).toHaveLength(2)
    expect(container.textContent).not.toContain("始终允许")

    await render(
      card({
        toolName: "mcp__pigclaude_workbench__browser_snapshot",
        input: {},
        browser: { kind: "snapshot" },
      }),
    )
    expect(container.textContent).toContain("读取当前本机页面的标题和可见正文，并发送给 Claude")
    expect(options()).toHaveLength(2)
  })

  it("shows the command and the numbered choices", async () => {
    await render(card())

    expect(container.querySelector('[role="dialog"][aria-label="需要权限"]')).not.toBeNull()
    expect(container.textContent).toContain("Claude 想要运行这条命令")
    expect(container.textContent).toContain("pnpm test")
    const choices = options()
    expect(choices.length).toBe(2)
    expect(choices[0]?.textContent).toContain("允许一次")
    expect(choices[0]?.textContent).toContain("仅允许这一次")
    expect(choices[1]?.textContent).toContain("拒绝")
  })

  it("describes a write permission with the target file and its content", async () => {
    await render(
      card({
        toolName: "Write",
        input: { file_path: "/tmp/a.ts", content: "export const a = 1\nexport const b = 2" },
      }),
    )

    expect(container.textContent).toContain("Claude 想要修改这个文件")
    expect(container.textContent).toContain("/tmp/a.ts")
    expect(container.textContent).toContain("+2")
    expect(container.querySelector(".perm-change-added")?.textContent).toContain(
      "+ export const a = 1",
    )
  })

  it("shows the replaced lines of an edit", async () => {
    await render(
      card({
        toolName: "Edit",
        input: { file_path: "/tmp/a.ts", old_string: "const a = 1", new_string: "const a = 2" },
      }),
    )

    expect(container.querySelector(".perm-change-removed")?.textContent).toContain("− const a = 1")
    expect(container.querySelector(".perm-change-added")?.textContent).toContain("+ const a = 2")
  })

  it("shows the URL of a fetch permission", async () => {
    await render(
      card({ toolName: "WebFetch", input: { url: "https://example.com/docs", prompt: "总结" } }),
    )

    expect(container.textContent).toContain("Claude 想要访问这个地址")
    expect(container.querySelector(".perm-prompt-target")?.textContent).toContain(
      "https://example.com/docs",
    )
  })

  it("shows the query and path of a search permission", async () => {
    await render(
      card({ toolName: "Grep", input: { pattern: "createSessionState", path: "src/renderer" } }),
    )

    expect(container.textContent).toContain("Claude 想要搜索")
    expect(container.querySelector(".perm-prompt-target")?.textContent).toContain(
      "createSessionState · src/renderer",
    )
  })

  it("answers with the first choice when the selected row is clicked", async () => {
    const onDecide = vi.fn()
    await render(card(), onDecide)

    await act(async () => options()[0]?.click())

    expect(onDecide).toHaveBeenCalledWith("permission-1", { decision: "allow" })
  })

  it("moves with the arrow keys and confirms with enter", async () => {
    const onDecide = vi.fn()
    await render(card(), onDecide)

    await act(async () => {
      options()[0]?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      )
    })
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true")

    await act(async () => {
      options()[1]?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      )
    })
    expect(onDecide).toHaveBeenCalledWith("permission-1", { decision: "deny" })
  })

  it("jumps to a choice with its number key", async () => {
    const onDecide = vi.fn()
    await render(card(), onDecide)

    await act(async () => {
      options()[0]?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "2", bubbles: true, cancelable: true }),
      )
    })
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true")

    await act(async () => {
      const confirm = [...container.querySelectorAll("button")].find(
        (candidate) => candidate.textContent?.trim() === "确认",
      )
      confirm?.click()
    })
    expect(onDecide).toHaveBeenCalledWith("permission-1", { decision: "deny" })
  })

  it("shows the plan body with start and keep choices", async () => {
    await render(card({ toolName: "ExitPlanMode", input: { plan: "# 计划\n\n先改测试再实现" } }))

    expect(container.textContent).toContain("计划已就绪")
    expect(container.textContent).toContain("先改测试再实现")
    const choices = options()
    expect(choices.length).toBe(2)
    expect(choices[0]?.textContent).toContain("开始执行")
    expect(choices[1]?.textContent).toContain("继续完善")
  })

  it("uses the suggestion index for both authorization scopes", async () => {
    const suggestion = { index: 2, label: "Bash(pnpm test)", canSaveProject: true }
    const onDecide = vi.fn()
    await render(card({ suggestions: [suggestion] }), onDecide)

    const choices = options()
    expect(choices.length).toBe(4)
    expect(choices[1]?.textContent).toContain("始终允许此命令")
    expect(choices[1]?.textContent).toContain("后续相同请求不再询问")
    expect(choices[2]?.textContent).toContain("此项目始终允许")

    await act(async () => choices[2]?.click())
    expect(onDecide).not.toHaveBeenCalled()
    await act(async () => choices[2]?.click())
    expect(onDecide).toHaveBeenCalledWith("permission-1", {
      decision: "allow",
      suggestion: { index: 2, scope: "project" },
    })
  })

  it("明确列出目录建议的授权范围及目录路径", async () => {
    await render(
      card({
        suggestions: [
          { index: 4, label: "/test/directory", kind: "directory", canSaveProject: true },
        ],
      }),
    )
    expect(options()[1]?.textContent).toContain("允许此会话访问目录")
    expect(options()[1]?.textContent).toContain("/test/directory")
    expect(options()[2]?.textContent).toContain("允许此项目的会话访问目录")
    expect(options()[2]?.textContent).toContain("/test/directory")
  })

  it("focuses the decline choice and disables digit shortcuts when required", async () => {
    const onDecide = vi.fn()
    await render(card({ defaultToNo: true }), onDecide)
    expect(document.activeElement).toBe(options()[1])
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "1", bubbles: true, cancelable: true }),
      )
    })
    expect(document.activeElement).toBe(options()[1])
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      )
    })
    expect(onDecide).toHaveBeenCalledWith("permission-1", { decision: "deny" })
  })
})
