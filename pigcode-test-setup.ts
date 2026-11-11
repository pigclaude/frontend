// 负责给拷入的 Pigcode 界面包补测试环境：jsdom 缺的 Range 几何、elementFromPoint 和 PointerEvent。
// 与 Pigcode 工作区根目录 vitest.setup.ts 的同名补丁一致；只在测试中加载。

if (typeof window !== "undefined" && typeof Range !== "undefined") {
  const emptyRects = {
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  } as unknown as DOMRectList
  Range.prototype.getClientRects = () => emptyRects
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0)
}

if (typeof document !== "undefined" && typeof document.elementFromPoint !== "function") {
  document.elementFromPoint = () => null
}

if (typeof window !== "undefined" && typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number
    readonly pointerType: string

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 0
      this.pointerType = init.pointerType ?? ""
    }
  }

  Object.defineProperty(window, "PointerEvent", {
    value: PointerEventPolyfill,
    configurable: true,
    writable: true,
  })
}
