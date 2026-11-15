// 为用户主动挑选页面元素的操作提供隔离世界脚本。

/** 只返回用户点击的元素标识和有限长度的文本。 */
export const elementPicker = `new Promise((resolve) => {
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
