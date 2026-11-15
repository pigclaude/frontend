// 负责验证权限询问卡片：正文按工具族显示命令或文件，选项带说明和编号，方向键与数字键能完成回答，
// 只有 SDK 给出建议时才出现“始终允许”。

// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LocaleProvider, type Locale } from "@pigclaude/ui-primitives"
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

async function render(
  request: SessionPermissionCard,
  onDecide = vi.fn(),
  locale: Locale = "zh-CN",
): Promise<void> {
  await act(async () =>
    root.render(
      createElement(LocaleProvider, {
        locale,
        children: createElement(PermissionPrompt, { request, onDecide }),
      }),
    ),
  )
}

describe("permission prompt", () => {
  it("在单次审批卡展示登记的插件、工具和调用参数", async () => {
    await render(
      card({
        toolName: "mcp__pigclaude_plugin_fixture__label",
        input: { value: "AB" },
        plugin: { id: "fixture.labels", name: "标签插件", toolName: "label" },
        defaultToNo: true,
      }),
    )
    expect(container.textContent).toContain("标签插件 (fixture.labels)")
    expect(container.querySelector(".perm-prompt-tool")?.textContent).toBe("label")
    expect(container.querySelector(".perm-prompt-code")?.textContent).toContain('"value": "AB"')
    expect(options().map((option) => option.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
    ])
    expect(container.textContent).not.toContain("始终允许")
  })

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
  })

  it.each([
    ["zh-CN", "读取当前本机页面的标题、标题层级、可交互元素和可见正文，并发送给 Claude"],
    [
      "en-US",
      "Read the current local page's title, heading hierarchy, interactive elements, and visible text, then send them to Claude",
    ],
  ] as const)("discloses the browser snapshot contents in %s", async (locale, summary) => {
    await render(
      card({
        toolName: "mcp__pigclaude_workbench__browser_snapshot",
        input: {},
        browser: { kind: "snapshot" },
      }),
      undefined,
      locale,
    )
    expect(container.textContent).toContain(summary)
    expect(options()).toHaveLength(2)
  })

  it.each([
    ["url", "Claude 想要跳转到这个本机地址"],
    ["back", "Claude 想要后退到这个本机地址"],
    ["forward", "Claude 想要前进到这个本机地址"],
    ["reload", "Claude 想要重新加载这个本机地址"],
  ] as const)("shows the %s navigation and the resolved URL", async (action, summary) => {
    const url = "http://[::1]:5173/docs?view=compact#intro"
    await render(
      card({
        toolName: "mcp__pigclaude_workbench__browser_navigate",
        input: { url: "http://localhost:4242/untrusted" },
        browser: { kind: "navigate", action, url },
        suggestions: [{ index: 0, label: "browser_navigate", canSaveProject: true }],
        defaultToNo: true,
      }),
    )

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain(summary)
    const target = dialog?.querySelector(".perm-prompt-target")
    expect(target?.textContent).toBe(url)
    expect(target?.querySelector("strong")?.textContent).toBe("http://[::1]:5173")
    expect(dialog?.textContent).not.toContain("localhost:4242")
    expect(options()).toHaveLength(2)
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true")
  })

  it("shows the verified click element and its page in the one-time prompt", async () => {
    const url = "http://localhost:4173/settings?tab=profile"
    await render(
      card({
        toolName: "mcp__pigclaude_workbench__browser_click",
        input: { ref: "untrusted" },
        browser: { kind: "click", url, ref: "e7", role: "button", name: "Save & close" },
        suggestions: [{ index: 0, label: "browser_click", canSaveProject: true }],
      }),
      undefined,
      "en-US",
    )

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain("Claude wants to click this page element")
    expect(dialog?.querySelector(".perm-prompt-target")?.textContent).toBe(url)
    expect([...(dialog?.querySelectorAll("dt") ?? [])].map((label) => label.textContent)).toEqual([
      "Element ref",
      "Role",
      "Name",
    ])
    expect([...(dialog?.querySelectorAll("dd") ?? [])].map((value) => value.textContent)).toEqual([
      "e7",
      "button",
      "Save & close",
    ])
    expect(dialog?.textContent).not.toContain("untrusted")
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

  it.each([
    ["zh-CN", "截取当前本机页面的可见区域（960 × 540 像素）并发送给 Claude", "允许一次", "拒绝"],
    [
      "en-US",
      "Capture the visible region of the local page (960 × 540 pixels) and send it to Claude",
      "Allow once",
      "Deny",
    ],
  ] as const)(
    "discloses the screenshot size and one-time choice in %s",
    async (locale, summary, allow, deny) => {
      const onDecide = vi.fn()
      const url = "http://localhost:4173/preview"
      await render(
        card({
          toolName: "mcp__pigclaude_workbench__browser_screenshot",
          input: {},
          browser: { kind: "screenshot", url, width: 960, height: 540 },
          suggestions: [{ index: 0, label: "browser_screenshot", canSaveProject: true }],
          defaultToNo: true,
        }),
        onDecide,
        locale,
      )

      const dialog = container.querySelector('[role="dialog"]')
      expect(dialog?.querySelector(".perm-prompt-summary")?.textContent).toBe(summary)
      expect(dialog?.querySelector(".perm-prompt-target")?.textContent).toBe(url)
      const choices = options()
      expect(choices).toHaveLength(2)
      expect(choices[0]?.textContent).toContain(allow)
      expect(choices[1]?.textContent).toContain(deny)
      expect(document.activeElement).toBe(choices[1])
      await act(async () => {
        choices[0]?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        )
      })
      expect(onDecide).toHaveBeenCalledWith("permission-1", { decision: "allow" })
    },
  )

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
