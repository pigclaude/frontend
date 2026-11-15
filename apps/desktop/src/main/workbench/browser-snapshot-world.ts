// 隔离世界里的快照采集脚本。引用跟随元素对象，表只活在隔离世界的全局对象里。

/** 返回可见标题、正文和元素元数据，或只读取一个已经登记的元素。 */
export const browserSnapshotWorld = String.raw`(({ generation, ref }) => {
  const key = Symbol.for("pigclaude.agent-browser-refs");
  let catalog = globalThis[key];
  if (!catalog || catalog.generation !== generation) {
    catalog = { generation, refs: new WeakMap(), byRef: new Map(), next: 0 };
    globalThis[key] = catalog;
  }

  const roles = new Set([
    "button", "link", "textbox", "searchbox", "checkbox", "radio", "switch", "combobox",
    "listbox", "option", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "slider",
    "spinbutton", "treeitem",
  ]);
  const native = "a[href], button, input, textarea, select, summary";
  const selector = [
    native, "[contenteditable]", "[tabindex]", "[onclick]",
    ...Array.from(roles, (role) => '[role~="' + role + '"]'),
  ].join(", ");
  const clean = (value, limit) => (value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  const hasViewport = innerWidth > 0 && innerHeight > 0;
  const visible = (element) => element.isConnected &&
    element.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
    (!hasViewport || Array.from(element.getClientRects()).some((box) => box.width > 0 && box.height > 0));
  const interactive = (element) => {
    if (!visible(element) || element.closest("[inert], [aria-disabled=true]") ||
        element.matches(":disabled, input[type=hidden]")) return false;
    return element.matches(native) || element.isContentEditable || element.tabIndex >= 0 ||
      element.hasAttribute("onclick") ||
      (element.getAttribute("role") || "").split(/\s+/).some((role) => roles.has(role));
  };
  const renderedText = (element) => visible(element) ? clean(element.innerText, 160) : "";

  function roleFor(element, type) {
    const explicit = (element.getAttribute("role") || "").split(/\s+/)
      .find((role) => roles.has(role));
    if (explicit) return explicit;
    switch (element.localName) {
      case "a": return element.hasAttribute("href") ? "link" : "interactive";
      case "button":
      case "summary": return "button";
      case "textarea": return "textbox";
      case "select": return element.multiple || element.size > 1 ? "listbox" : "combobox";
      case "input":
        if (type === "checkbox" || type === "radio") return type;
        if (type === "range") return "slider";
        if (type === "number") return "spinbutton";
        if (type === "search") return "searchbox";
        if (["button", "image", "reset", "submit", "file", "color"].includes(type)) return "button";
        return "textbox";
      default: return element.isContentEditable ? "textbox" : "interactive";
    }
  }

  function nameFor(element, type) {
    const labelledBy = (element.getAttribute("aria-labelledby") || "").trim()
      .split(/\s+/).slice(0, 8).flatMap((id) => {
        const label = id && document.getElementById(id);
        return label ? [renderedText(label)] : [];
      }).join(" ");
    const labels = Array.from(element.labels || []).slice(0, 8).map(renderedText).join(" ");
    const buttonLabel = ["button", "reset", "submit"].includes(type) ? element.value : "";
    return clean(labelledBy, 160) || clean(element.getAttribute("aria-label"), 160) ||
      clean(labels, 160) || renderedText(element) || clean(buttonLabel, 160) ||
      clean(element.getAttribute("alt"), 160) || clean(element.getAttribute("title"), 160) ||
      clean(element.getAttribute("placeholder"), 160);
  }

  function describe(element, elementRef) {
    const type = element.localName === "input" ? element.type : undefined;
    return {
      ref: elementRef, role: roleFor(element, type), name: nameFor(element, type),
      ...(type === undefined ? {} : { type }),
    };
  }

  function visibleBodyText() {
    if (!document.body) return "";
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const parts = [];
    let length = 0;
    for (let at = 0; at < 12000 && length < 6000; at += 1) {
      const node = walker.nextNode();
      if (!node) break;
      const parent = node.parentElement;
      if (!parent || parent.closest("textarea, select, script, style, template") || !visibleTextParent(parent))
        continue;
      const text = clean(node.nodeValue, 6000 - length);
      if (!text) continue;
      parts.push(text);
      length += text.length + 1;
    }
    return parts.join("\n");
  }

  function visibleTextParent(element) {
    while (element && !visible(element)) {
      const style = getComputedStyle(element);
      if (style.display !== "contents" || style.visibility !== "visible") return false;
      element = element.parentElement;
    }
    return element !== null;
  }

  if (ref !== undefined) {
    const element = catalog.byRef.get(ref);
    return element && interactive(element) ? describe(element, ref) : null;
  }

  const headings = [];
  for (const heading of document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading]")) {
    if (!visible(heading)) continue;
    const level = /^h[1-6]$/.test(heading.localName)
      ? Number(heading.localName[1]) : (Number(heading.getAttribute("aria-level")) || 2);
    const text = renderedText(heading);
    if (text && Number.isSafeInteger(level) && level > 0) headings.push({ level, text });
    if (headings.length === 40) break;
  }

  const elements = [];
  const seen = new Map();
  for (const element of document.querySelectorAll(selector)) {
    if (!interactive(element)) continue;
    let elementRef = catalog.refs.get(element);
    if (elementRef === undefined) {
      elementRef = generation + ":" + (++catalog.next);
      catalog.refs.set(element, elementRef);
    }
    seen.set(elementRef, element);
    elements.push(describe(element, elementRef));
    if (elements.length === 80) break;
  }
  catalog.byRef = seen;
  return { headings, elements, text: visibleBodyText() };
})`
