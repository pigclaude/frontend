// 用户主动选择页面元素时，从隔离世界读取有限的选择器和文本。

import type { WebContents } from "electron"
import type { WorkbenchBrowserElement } from "../../workbench-contract"

/** 捕获一次人工选择，过滤返回值并限制发给主窗口的文本长度。 */
export async function pickWorkbenchBrowserElement(
  contents: WebContents,
): Promise<Pick<WorkbenchBrowserElement, "selector" | "text"> | null> {
  contents.focus()
  const result: unknown = await contents.executeJavaScriptInIsolatedWorld(
    1001,
    [{ code: elementPicker }],
    true,
  )
  if (typeof result !== "object" || result === null) return null
  const selected = result as Partial<WorkbenchBrowserElement>
  if (typeof selected.selector !== "string" || typeof selected.text !== "string") return null
  return { selector: selected.selector.slice(0, 500), text: selected.text.slice(0, 1000) }
}

const elementPicker = `new Promise((resolve) => {
  const cancelKey = (event) => { if (event.key === "Escape") finish(null) };
  const select = (event) => {
    if (!(event.target instanceof Element)) return finish(null);
    event.preventDefault();
    event.stopImmediatePropagation();
    const element = event.target;
    const path = [];
    for (let item = element; item && path.length < 5; item = item.parentElement) {
      if (item.id) { path.unshift("#" + CSS.escape(item.id)); break; }
      const index = item.parentElement ? Array.from(item.parentElement.children).indexOf(item) + 1 : 1;
      path.unshift(item.localName + ":nth-child(" + index + ")");
    }
    finish({ selector: path.join(" > "), text: (element.textContent || "").trim().slice(0, 1000) });
  };
  const timer = setTimeout(() => finish(null), 15000);
  function finish(value) {
    clearTimeout(timer);
    document.removeEventListener("click", select, true);
    document.removeEventListener("keydown", cancelKey, true);
    resolve(value);
  }
  document.addEventListener("click", select, true);
  document.addEventListener("keydown", cancelKey, true);
})`
