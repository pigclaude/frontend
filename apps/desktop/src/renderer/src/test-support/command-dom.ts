// 负责测试局部补齐 Base UI Command 与 Base UI 所需 DOM 接口，结束时恢复此前的定义。

/** 安装尺寸观察与滚动接口替身，返回仅恢复本次改动的清理函数。 */
export function installCommandDom(): () => void {
  const resize = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver")
  const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView")
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  })
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: () => undefined,
  })
  return () => {
    if (resize) Object.defineProperty(globalThis, "ResizeObserver", resize)
    else Reflect.deleteProperty(globalThis, "ResizeObserver")
    if (scroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scroll)
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView")
  }
}
