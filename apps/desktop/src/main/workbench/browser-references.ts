// 管理单个 Agent 标签的快照世代，校验从隔离世界返回的普通数据。

import { randomUUID } from "node:crypto"
import type { WebContents } from "electron"
import { BrowserActionError } from "./browser-action-request"
import { browserSnapshotWorld } from "./browser-snapshot-world"

const snapshotWorld = 1002

/** 供工具展示和后续审批使用的当前元素信息。引用不含 DOM 属性。 */
export type AgentBrowserElement = {
  ref: string
  role: string
  name: string
  type?: string
}

/** 目标元素在当前主帧视口内实际命中的 CSS 像素。 */
export type AgentBrowserPoint = { x: number; y: number }

type Heading = { level: number; text: string }

/** 单份快照的可见页面内容，不含元素对象或输入值。 */
export type AgentBrowserSnapshot = {
  headings: Heading[]
  elements: AgentBrowserElement[]
  text: string
}

/** 引用已因导航、元素消失或更新的快照而失效。 */
export class StaleBrowserReference extends BrowserActionError {
  readonly code = "WORKBENCH_BROWSER_REF_STALE"

  /** 错误内容给工具调用者指出恢复步骤。 */
  constructor() {
    super("The page or element changed. Please take a new browser snapshot.")
  }
}

/** 一个 Agent 标签的引用世代；主框架导航和渲染进程崩溃都会使旧引用失效。 */
export class BrowserReferences {
  #generation = randomUUID()

  /** 绑定已经配置成隔离浏览上下文的 Agent 标签。 */
  constructor(private readonly contents: WebContents) {
    contents.on("did-start-navigation", (event) => {
      if (event.isMainFrame) this.invalidate()
    })
    contents.on("did-navigate", () => this.invalidate())
    contents.on("did-navigate-in-page", (_event, _url, isMainFrame) => {
      if (isMainFrame) this.invalidate()
    })
    contents.on("render-process-gone", () => this.invalidate())
  }

  /** 使之前发给工具调用者的所有引用失效。 */
  invalidate(): void {
    this.#generation = randomUUID()
  }

  /** 捕获文档世代和当前地址，供批准后与其他继续点同步复核。 */
  documentGuard(): () => void {
    if (this.contents.isDestroyed()) throw new StaleBrowserReference()
    const generation = this.#generation
    const url = this.contents.getURL()
    return () => {
      if (
        this.contents.isDestroyed() ||
        this.#generation !== generation ||
        this.contents.getURL() !== url
      )
        throw new StaleBrowserReference()
    }
  }

  /** 从当前文档读取可见内容与元素，把旧帧的结果拦在主进程。 */
  async snapshot(): Promise<AgentBrowserSnapshot> {
    const value = await this.#read()
    if (
      !record(value) ||
      typeof value.text !== "string" ||
      !Array.isArray(value.headings) ||
      !value.headings.every(isHeading) ||
      !Array.isArray(value.elements) ||
      !value.elements.every(isElement)
    )
      throw new Error("WORKBENCH_PREVIEW_FAILED")
    return { headings: value.headings, elements: value.elements, text: value.text }
  }

  /** 只解析当前快照里的引用。失效后请求调用者重新拍快照。 */
  async resolve(ref: string): Promise<AgentBrowserElement> {
    this.#assertRef(ref)
    const value = await this.#read(ref)
    if (!isElement(value)) throw new StaleBrowserReference()
    return value
  }

  /** 在隔离世界核对已批准的元数据、滚动到中央，并只接受实际打到该元素的点。 */
  async clickPoint(target: AgentBrowserElement): Promise<AgentBrowserPoint> {
    this.#assertRef(target.ref)
    const value = await this.#read(target.ref, target)
    if (record(value) && value.blocked === true)
      throw new BrowserActionError(
        "The approved element is covered or outside the viewport. Please take a new browser snapshot.",
      )
    if (
      !record(value) ||
      typeof value.x !== "number" ||
      !Number.isFinite(value.x) ||
      value.x < 0 ||
      typeof value.y !== "number" ||
      !Number.isFinite(value.y) ||
      value.y < 0
    )
      throw new StaleBrowserReference()
    return { x: value.x, y: value.y }
  }

  #assertRef(ref: string): void {
    if (ref.length > 64 || !ref.startsWith(`${this.#generation}:`))
      throw new StaleBrowserReference()
  }

  async #read(ref?: string, click?: AgentBrowserElement): Promise<unknown> {
    const assertCurrent = this.documentGuard()
    const generation = this.#generation
    try {
      const value: unknown = await this.contents.executeJavaScriptInIsolatedWorld(snapshotWorld, [
        { code: `${browserSnapshotWorld}(${JSON.stringify({ generation, ref, click })})` },
      ])
      assertCurrent()
      return value
    } catch (error) {
      if (ref !== undefined) throw new StaleBrowserReference()
      assertCurrent()
      throw error
    }
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isHeading(value: unknown): value is Heading {
  return record(value) && typeof value.level === "number" && typeof value.text === "string"
}

function isElement(value: unknown): value is AgentBrowserElement {
  return (
    record(value) &&
    typeof value.ref === "string" &&
    typeof value.role === "string" &&
    typeof value.name === "string" &&
    (value.type === undefined || typeof value.type === "string")
  )
}
