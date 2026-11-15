// 隔离世界里的快照采集脚本。引用跟随元素对象，表只活在隔离世界的全局对象里。

/** 返回可见页面快照，或在隔离世界核对动作的已登记元素和状态。 */
export const browserSnapshotWorld = String.raw`(({ generation, ref, click, input }) => {
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
  const textInputTypes = new Set(["text", "search", "tel", "url", "email", "password", "number"]);
  const selector = [
    native, "[contenteditable]", "[tabindex]", "[onclick]",
    ...Array.from(roles, (role) => '[role~="' + role + '"]'),
  ].join(", ");
  const clean = (value, limit) => (value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  const hasViewport = innerWidth > 0 && innerHeight > 0;
  let containers = new WeakMap();
  const clips = (overflow) => overflow === "hidden" || overflow === "clip";
  const scrolls = (overflow) => overflow === "auto" || overflow === "scroll";
  const hasClipping = (box) => box.clipX || box.clipY;
  const visible = (element) => element.isConnected &&
    element.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
    visibleRect(element.getClientRects(), containingBoxes(element.parentElement));
  function containingBox(element) {
    if (containers.has(element)) return containers.get(element);
    const style = getComputedStyle(element);
    const clipX = clips(style.overflowX);
    const clipY = clips(style.overflowY);
    const scrollX = scrolls(style.overflowX) && element.clientWidth > 0 &&
      element.scrollWidth > element.clientWidth;
    const scrollY = scrolls(style.overflowY) && element.clientHeight > 0 &&
      element.scrollHeight > element.clientHeight;
    let box = null;
    if ((clipX || clipY || scrollX || scrollY) &&
        style.display !== "contents" && style.display !== "inline") {
      const rect = element.getBoundingClientRect();
      const scaleX = element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1;
      const scaleY = element.offsetHeight > 0 ? rect.height / element.offsetHeight : 1;
      const left = rect.left + element.clientLeft * scaleX;
      const top = rect.top + element.clientTop * scaleY;
      box = {
        clipX, clipY, scrollX, scrollY,
        left, top,
        right: left + element.clientWidth * scaleX,
        bottom: top + element.clientHeight * scaleY,
      };
    }
    containers.set(element, box);
    return box;
  }
  function containingBoxes(parent) {
    const result = [];
    for (let element = parent; element; element = element.parentElement) {
      const box = containingBox(element);
      if (box) result.push(box);
    }
    return result;
  }
  function visibleRect(rectangles, outside) {
    if (!hasViewport && !outside.some(hasClipping)) return true;
    return Array.from(rectangles).some(({ left, right, top, bottom }) => {
      if (left >= right || top >= bottom) return false;
      for (const box of outside) {
        // 普通滚动容器可以把后代移到其可用区域，外层裁剪约束的是该区域。
        if (box.scrollX) {
          left = box.left;
          right = box.right;
        } else if (box.clipX) {
          left = Math.max(left, box.left);
          right = Math.min(right, box.right);
        }
        if (box.scrollY) {
          top = box.top;
          bottom = box.bottom;
        } else if (box.clipY) {
          top = Math.max(top, box.top);
          bottom = Math.min(bottom, box.bottom);
        }
        if (left >= right || top >= bottom) return false;
      }
      return true;
    });
  }
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

  function nameFor(element, type, includeContents) {
    const labelText = (label) => !includeContents &&
      (element.contains(label) || (element.isContentEditable && label.contains(element)))
        ? "" : renderedText(label);
    const labelledBy = (element.getAttribute("aria-labelledby") || "").trim()
      .split(/\s+/).slice(0, 8).flatMap((id) => {
        const label = id && document.getElementById(id);
        return label ? [labelText(label)] : [];
      }).join(" ");
    const labels = Array.from(element.labels || []).slice(0, 8).map(labelText).join(" ");
    const buttonLabel = ["button", "reset", "submit"].includes(type) ? element.value : "";
    return clean(labelledBy, 160) || clean(element.getAttribute("aria-label"), 160) ||
      clean(labels, 160) || (includeContents ? renderedText(element) : "") || clean(buttonLabel, 160) ||
      clean(element.getAttribute("alt"), 160) || clean(element.getAttribute("title"), 160) ||
      clean(element.getAttribute("placeholder"), 160);
  }

  function describe(element, elementRef, includeContents = true) {
    const type = element.localName === "input" ? element.type : undefined;
    return {
      ref: elementRef, role: roleFor(element, type), name: nameFor(element, type, includeContents),
      ...(type === undefined ? {} : { type }),
    };
  }

  function sameElement(current, expected) {
    return current.role === expected.role && current.name === expected.name && current.type === expected.type;
  }

  function nextPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async function clickPoint(element) {
    const sameTarget = () => interactive(element) && sameElement(describe(element, ref), click);
    if (!sameTarget()) return null;
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    // 确保滚动后至少绘制过一帧，再把当前坐标交给 Chromium 的原生输入路由。
    await nextPaint();
    containers = new WeakMap();
    if (!sameTarget()) return null;
    const bounds = element.getBoundingClientRect();
    const left = Math.max(0, bounds.left);
    const right = Math.min(innerWidth, bounds.right);
    const top = Math.max(0, bounds.top);
    const bottom = Math.min(innerHeight, bounds.bottom);
    if (right <= left || bottom <= top) return { blocked: true };
    const x = (left + right) / 2;
    const y = (top + bottom) / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !element.contains(hit)) return { blocked: true };
    for (let node = hit; node !== element; node = node.parentElement) {
      if (node.matches(selector) && interactive(node)) return { blocked: true };
    }
    return { x, y };
  }

  function editable(element) {
    if (!interactive(element) || element.getAttribute("aria-readonly") === "true") return false;
    if (element instanceof HTMLInputElement) return !element.readOnly && textInputTypes.has(element.type);
    if (element instanceof HTMLTextAreaElement) return !element.readOnly;
    return element instanceof HTMLElement && element.isContentEditable && !element.parentElement?.isContentEditable;
  }

  async function inputTarget(element) {
    if (!editable(element)) return input.phase === "inspect" ? { editable: false } : null;
    const current = () => describe(element, ref, false);
    if (input.phase === "inspect") {
      const field = current();
      return { ...field, isPassword: field.type === "password" };
    }
    if (!sameElement(current(), input.target)) return null;
    if (input.phase === "focus") {
      element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      element.focus({ preventScroll: true });
      await nextPaint();
      containers = new WeakMap();
      if (!editable(element) || !sameElement(current(), input.target)) return null;
    }
    if (document.activeElement !== element) return { focused: false };
    if (!element.isContentEditable) return { focused: true };
    const selection = document.getSelection();
    return { focused: !!selection && element.contains(selection.anchorNode) && element.contains(selection.focusNode) };
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
      if (!parent || parent.closest("textarea, select, script, style, template") || !visibleTextParent(parent, node))
        continue;
      const text = clean(node.nodeValue, 6000 - length);
      if (!text) continue;
      parts.push(text);
      length += text.length + 1;
    }
    return parts.join("\n");
  }

  function visibleTextParent(element, node) {
    const outside = containingBoxes(element);
    while (element && !visible(element)) {
      const style = getComputedStyle(element);
      if (style.display !== "contents" || style.visibility !== "visible") return false;
      element = element.parentElement;
    }
    if (!element) return false;
    if (!outside.some(hasClipping)) return true;
    const range = document.createRange();
    range.selectNodeContents(node);
    return visibleRect(range.getClientRects(), outside);
  }

  if (ref !== undefined) {
    const element = catalog.byRef.get(ref);
    if (click !== undefined) return element ? clickPoint(element) : null;
    if (input !== undefined) return element ? inputTarget(element) : null;
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
