// 负责验证文件树的 Git 装饰和右键菜单：标出改动、只看改动，右键打开、显示、复制路径和 @ 提及。

// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import {
  button,
  fakeWorkbench,
  fire,
  installNativeMenus,
  openFilesSurface,
  panelTabs,
  projectRoot,
  settle,
  treeRow,
  workbenchRoot,
} from "../test-support/workbench-harness"

const screen = workbenchRoot()
const files = { "README.md": "# app\n", "new.txt": "new\n", "src/main.ts": "export {}\n" }

function rowNames(): string[] {
  return [...document.querySelectorAll('[role="treeitem"]')].map(
    (row) => row.getAttribute("aria-label") ?? "",
  )
}

async function expand(name: string): Promise<void> {
  const row = treeRow(name)
  if (row.getAttribute("aria-expanded") === "false") await fire(row, "click")
}

describe("workbench file tree", () => {
  it("marks changed files and can show only the changes", async () => {
    const fake = fakeWorkbench(files)
    fake.changes = [
      { path: "src/main.ts", status: " M" },
      { path: "new.txt", status: "??" },
    ]
    await openFilesSurface(screen, fake)
    await expand("src")

    expect(treeRow("main.ts").dataset.git).toBe("modified")
    expect(treeRow("new.txt").dataset.git).toBe("untracked")
    expect(treeRow("README.md").dataset.git).toBeUndefined()

    await fire(button("仅显示变更文件"), "click")
    expect(rowNames()).toEqual(["src", "main.ts", "new.txt"])
    await fire(button("显示全部文件"), "click")
    expect(rowNames()).toContain("README.md")
  })

  it("re-reads the tree and Git status while Claude is still working", async () => {
    const fake = fakeWorkbench(files)
    await openFilesSurface(screen, fake)
    expect(rowNames()).not.toContain("added.ts")

    fake.disk.set("added.ts", { text: "export {}\n", mtimeMs: 1 })
    fake.changes = [{ path: "added.ts", status: "??" }]
    await screen.render(fake.bridge, { workspaceRevision: 1 })
    await settle()

    expect(treeRow("added.ts").dataset.git).toBe("untracked")
  })

  it("shows no decorations or change filter outside a Git work tree", async () => {
    const fake = fakeWorkbench(files)
    await openFilesSurface(screen, fake)

    expect(fake.bridge.status).toHaveBeenCalledWith(projectRoot)
    expect(document.querySelector('button[aria-label="仅显示变更文件"]')).toBeNull()
    expect(document.querySelector('[role="treeitem"][data-git]')).toBeNull()
  })

  it("opens, reveals, copies and mentions a file from its context menu", async () => {
    const fake = fakeWorkbench(files)
    const menus = installNativeMenus(fake)
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    const mentions: unknown[] = []
    const onMention = (event: Event) => mentions.push((event as CustomEvent).detail)
    window.addEventListener("pigcode:composer-mention", onMention)
    try {
      await openFilesSurface(screen, fake)
      await expand("src")

      menus.answer("open-tab", "reveal", "copy-path", "copy-relative", "mention")
      for (let index = 0; index < 5; index += 1) {
        await fire(treeRow("main.ts"), "contextmenu", { clientX: 5, clientY: 6 })
      }

      expect(menus.labels(0)).toEqual([
        "打开",
        "在新标签页打开",
        "打开方式",
        "另存为…",
        "在文件管理器中显示",
        "复制绝对路径",
        "复制相对路径",
        "添加到对话",
      ])
      expect(panelTabs()).toEqual([{ title: "main.ts", preview: false }])
      expect(fake.bridge.reveal).toHaveBeenCalledExactlyOnceWith(projectRoot, "src/main.ts")
      expect(writeText.mock.calls).toEqual([[projectRoot + "/src/main.ts"], ["src/main.ts"]])
      expect(mentions).toEqual([{ path: "src/main.ts" }])
    } finally {
      window.removeEventListener("pigcode:composer-mention", onMention)
    }
  })

  it("opens the project folder from the root menu", async () => {
    const fake = fakeWorkbench(files)
    const menus = installNativeMenus(fake)
    await openFilesSurface(screen, fake)

    menus.answer("reveal")
    await fire(button("工作目录操作"), "click")

    expect(menus.labels(0)).toEqual(["在访达中打开", "复制绝对路径"])
    expect(fake.bridge.reveal).toHaveBeenCalledExactlyOnceWith(projectRoot, "")
  })
})
