// 负责给 renderer 的 jsdom 测试补齐 Base UI 和 ProseMirror 需要的浏览器几何与事件构造器。

if (typeof globalThis.MouseEvent === "function" && typeof globalThis.PointerEvent !== "function") {
  Object.defineProperty(globalThis, "PointerEvent", {
    configurable: true,
    writable: true,
    value: globalThis.MouseEvent,
  })
}

if (typeof document !== "undefined" && typeof document.elementFromPoint !== "function") {
  document.elementFromPoint = () => null
}

// ProseMirror 在更新选区时会读取 Range 的几何；jsdom 没有实现，补成空矩形。
if (typeof globalThis.Range === "function") {
  const emptyRects = {
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  } as unknown as DOMRectList
  globalThis.Range.prototype.getClientRects = () => emptyRects
  globalThis.Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0)
}
