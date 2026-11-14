// 负责工作台页面测试的公共夹具：内存里的项目文件、记录调用的假工作台桥、原生菜单替身，
// 以及带语言、Toast 和扩展点注册表的工作台挂载与常用查找。
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, vi } from "vitest"
import type {
  WorkbenchBridge,
  WorkbenchChange,
  WorkbenchEvent,
  WorkbenchFile,
  WorkbenchListing,
} from "../../../workbench-contract"
import { AppProviders } from "../app-providers"
import { Workbench, type WorkbenchProps } from "../workbench/workbench"

/** 工作台测试里的项目目录。 */
export const projectRoot = "/Users/me/app"

/**
 * 内存项目和记录调用的工作台桥；change 模拟别处改了磁盘上的文件，changes 是 Git 状态，
 * emit 模拟主进程发来的工作台事件。
 */
export type FakeWorkbench = {
  bridge: WorkbenchBridge
  disk: Map<string, { text: string; mtimeMs: number }>
  change: (path: string, text: string) => void
  changes: WorkbenchChange[] | null
  emit: (event: WorkbenchEvent) => Promise<void>
}

function childrenOf(paths: readonly string[], directory: string): WorkbenchListing["entries"] {
  const prefix = directory ? directory + "/" : ""
  const entries = new Map<string, "file" | "directory">()
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue
    const [name, ...rest] = path.slice(prefix.length).split("/")
    if (name) entries.set(name, rest.length > 0 ? "directory" : "file")
  }
  return [...entries]
    .sort(([left, leftKind], [right, rightKind]) =>
      leftKind === rightKind ? left.localeCompare(right) : leftKind === "directory" ? -1 : 1,
    )
    .map(([name, kind]) => ({ name, path: prefix + name, kind }))
}

/** 用给定的文件建一个内存项目；没列出的桥方法被调用时让测试失败。 */
export function fakeWorkbench(files: Record<string, string>): FakeWorkbench {
  const listeners = new Set<(event: WorkbenchEvent) => void>()
  const disk = new Map(Object.entries(files).map(([path, text]) => [path, { text, mtimeMs: 1 }]))
  const read = (path: string): WorkbenchFile => {
    const entry = disk.get(path)
    if (!entry) throw new Error("WORKBENCH_PATH_INVALID")
    return {
      path,
      text: entry.text,
      truncated: false,
      binary: false,
      size: entry.text.length,
      mtimeMs: entry.mtimeMs,
      eol: "lf",
    }
  }
  const used: Partial<Record<keyof WorkbenchBridge, ReturnType<typeof vi.fn>>> = {
    list: vi.fn(async (_root: string, path: string) => ({
      truncated: false,
      entries: childrenOf([...disk.keys()], path),
    })),
    search: vi.fn(async (_root: string, query: string) => ({
      truncated: false,
      entries: [...disk.keys()]
        .filter((path) => path.includes(query))
        .map((path) => ({ path, kind: "file" as const })),
    })),
    read: vi.fn(async (_root: string, path: string) => read(path)),
    save: vi.fn(async (_root: string, path: string, text: string, mtimeMs: number | null) => {
      const entry = disk.get(path)
      if (!entry) throw new Error("WORKBENCH_PATH_INVALID")
      if (mtimeMs !== null && mtimeMs !== entry.mtimeMs) throw new Error("WORKBENCH_FILE_CHANGED")
      disk.set(path, { text, mtimeMs: entry.mtimeMs + 1 })
      return read(path)
    }),
    status: vi.fn(async () => fake.changes),
    reveal: vi.fn(async () => undefined),
    reportUnsaved: vi.fn(async () => undefined),
    unsavedDone: vi.fn(async () => undefined),
    editors: vi.fn(async () => [{ id: "cursor", name: "Cursor" }]),
    openFile: vi.fn(async () => undefined),
    saveAs: vi.fn(async () => true),
    worktrees: vi.fn(async () => []),
    useWorktree: vi.fn(async () => undefined),
    branches: vi.fn(async () => null),
    subscribe: vi.fn((listener: (event: WorkbenchEvent) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
  }
  const bridge = new Proxy(used, {
    get(target, name: string) {
      const known = target[name as keyof WorkbenchBridge]
      if (known) return known
      return () => {
        throw new Error("unexpected workbench call: " + name)
      }
    },
  }) as unknown as WorkbenchBridge
  const fake: FakeWorkbench = {
    bridge,
    disk,
    change(path, text) {
      const entry = disk.get(path)
      disk.set(path, { text, mtimeMs: (entry?.mtimeMs ?? 0) + 1 })
    },
    changes: null,
    async emit(event) {
      await act(async () => listeners.forEach((listener) => listener(event)))
      await settle()
    },
  }
  return fake
}

type PopupMenu = NonNullable<NonNullable<Window["pigcodeNative"]>["popupMenu"]>

/** 原生菜单替身：按顺序回答每次弹出的菜单，并记下弹出过的菜单项。 */
export type NativeMenus = {
  popupMenu: ReturnType<typeof vi.fn<PopupMenu>>
  answer: (...choices: Array<string | null>) => void
  /** 第 index 次弹出的菜单里可点的项。 */
  labels: (index: number) => string[]
}

/** 安装 window.pigcodeNative 的原生菜单和编辑器列表。 */
export function installNativeMenus(fake: FakeWorkbench): NativeMenus {
  const answers: Array<string | null> = []
  const popupMenu = vi.fn<PopupMenu>(async () => answers.shift() ?? null)
  window.pigcodeNative = {
    platform: "darwin",
    setThemeSource: async () => undefined,
    windowControl: async () => undefined,
    isMaximized: async () => false,
    previewOpen: () => Promise.reject(new Error("PREVIEW_UNAVAILABLE")),
    previewClose: () => undefined,
    popupMenu,
    listOpenApps: async () =>
      (await fake.bridge.editors()).map((editor) => ({
        ...editor,
        kind: "editor" as const,
        icon: null,
      })),
  }
  return {
    popupMenu,
    answer: (...choices) => answers.push(...choices),
    labels: (index) =>
      (popupMenu.mock.calls[index]?.[0] ?? []).flatMap((item) =>
        "label" in item && item.label ? [item.label] : [],
      ),
  }
}

/** 一个测试文件里的工作台挂载点。 */
export type WorkbenchRoot = {
  readonly container: HTMLDivElement
  render: (bridge: WorkbenchBridge, overrides?: Partial<WorkbenchProps>) => Promise<void>
}

/** 每个测试前挂一个新根节点，测试后卸载并清掉原生桥和本地存储。 */
export function workbenchRoot(): WorkbenchRoot {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    window.localStorage.clear()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
    host?.remove()
    delete window.pigcodeNative
    vi.unstubAllGlobals()
  })

  return {
    get container() {
      if (host === null) throw new Error("工作台挂载点只在测试运行期间可用")
      return host
    },
    async render(bridge, overrides = {}) {
      const props: WorkbenchProps = {
        bridge,
        root: projectRoot,
        sessionId: null,
        sessionActive: false,
        turnActive: false,
        workspaceRevision: 0,
        visible: true,
        open: true,
        maximized: false,
        onToggle: () => undefined,
        onShow: () => undefined,
        onMaximize: () => undefined,
        onSelectWorkspace: async () => undefined,
        ...overrides,
      }
      await act(async () =>
        root?.render(createElement(AppProviders, null, createElement(Workbench, props))),
      )
    },
  }
}

/** 等异步读取落定：连续让出几轮微任务和计时器。 */
export async function settle(): Promise<void> {
  for (let round = 0; round < 5; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

/** 文件树里名字为 name 的一行。 */
export function treeRow(name: string): HTMLElement {
  const row = [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')].find(
    (item) => item.getAttribute("aria-label") === name,
  )
  expect(row, "文件树行 " + name).toBeDefined()
  return row as HTMLElement
}

/** 右栏的标签：标题和是否是预览标签。 */
export function panelTabs(): Array<{ title: string; preview: boolean }> {
  return [...document.querySelectorAll<HTMLElement>(".right-panel .surface-tab")].map((tab) => ({
    title: tab.querySelector('[role="tab"]')?.textContent ?? "",
    preview: tab.dataset.preview === "true",
  }))
}

/** 当前文件的编辑器。 */
export function fileEditor(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>(".file-view textarea")
}

/** 在元素上触发一次冒泡的鼠标事件，再等异步读取落定。 */
export async function fire(element: Element, type: string, init: MouseEventInit = {}) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }))
  })
  await settle()
}

/** 无障碍名称或文字是 name 的按钮。 */
export function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name,
  )
  expect(found, "按钮 " + name).toBeDefined()
  return found as HTMLButtonElement
}

/** 右栏里标题为 title 的标签。 */
export function panelTab(title: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('.right-panel [role="tab"]')].find(
    (item) => item.textContent === title,
  )
  expect(found, "标签 " + title).toBeDefined()
  return found as HTMLElement
}

/** 挂上工作台并从启动器打开「文件」。 */
export async function openFilesSurface(screen: WorkbenchRoot, fake: FakeWorkbench): Promise<void> {
  await screen.render(fake.bridge)
  const launcher = [...document.querySelectorAll<HTMLElement>(".surface-launcher-item")].find(
    (item) => item.querySelector(".grow")?.textContent === "文件",
  )
  expect(launcher, "启动器里的文件").toBeDefined()
  await fire(launcher as HTMLElement, "click")
}
