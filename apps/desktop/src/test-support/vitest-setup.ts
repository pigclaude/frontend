// 负责给 renderer 的 jsdom 测试补齐 Base UI 需要的浏览器事件构造器。

if (typeof globalThis.MouseEvent === "function" && typeof globalThis.PointerEvent !== "function") {
  Object.defineProperty(globalThis, "PointerEvent", {
    configurable: true,
    writable: true,
    value: globalThis.MouseEvent,
  })
}
