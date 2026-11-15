// 将宿主批准的文字交给当前输入区的纯文本粘贴处理，保留草稿与其他输入区。
const editableComposer = ".composer-editor .tiptap[contenteditable='true']"

/** 仅在有唯一可见可编辑输入区时，捕获这次用户命令的目标。 */
export function pluginComposerTarget(): HTMLElement | null {
  const editors = [...document.querySelectorAll<HTMLElement>(editableComposer)].filter(
    (editor) => editor.getClientRects().length > 0,
  )
  return editors.length === 1 ? (editors[0] ?? null) : null
}

/** 往捕获的输入区插入纯文本，输入区已切换或失效时丢弃这次结果。 */
export function insertPluginComposerText(target: HTMLElement, text: string): void {
  if (!text || target !== pluginComposerTarget()) return
  const data = new DataTransfer()
  data.setData("text/plain", text)
  // 交给 TipTap 已有的 handlePaste，既不改系统剪贴板，也不会触发发送。
  target.dispatchEvent(
    new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
  )
}
