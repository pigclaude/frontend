// 负责会话输入区：TipTap 正文、权限模式、账号、模型和思考深度菜单。
import { Placeholder } from "@tiptap/extension-placeholder"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { useMemo, useRef } from "react"
import { Icon } from "./icon"
import { submitComposerText } from "./composer-submit"
import { createSmartPunctuation } from "./smart-punctuation"
import {
  getComposerKeyAction,
  permissionModes,
  thinkingDepths,
  type PermissionMode,
  type ThinkingDepth,
} from "./composer-options"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"
import { Button } from "./ui/button"

/** 模型菜单选项，id 传给 session.start/setModel，label 只用于展示。 */
export type ComposerModelOption = { id: string; label: string }

/** 账号菜单选项，id 传给 session.start 的 accountId。 */
export type ComposerAccountOption = { id: string; label: string }

/** 会话输入区 props。 */
export type ComposerProps = {
  placeholder: string
  tall?: boolean
  menuSide: "top" | "bottom"
  model: string
  modelOptions: readonly ComposerModelOption[]
  onModel: (model: string) => void
  account: string
  accountOptions: readonly ComposerAccountOption[]
  onAccount: (account: string) => void
  showAccount: boolean
  depth: ThinkingDepth
  onDepth: (depth: ThinkingDepth) => void
  permissionMode?: PermissionMode
  onPermissionMode?: (mode: PermissionMode) => void
  /** 返回 true 表示消息已被接受，只有此时才清空输入区。 */
  onSubmit: (text: string) => boolean | Promise<boolean>
  /** 当前 turn 未结束时禁止发送，避免连发产生第二个 turn。 */
  disabled?: boolean
  smartPunctuation: boolean
}

/** 去掉占位文案、布局和提交后的输入区设置，空状态和会话页共用。 */
export type ComposerSettings = Omit<ComposerProps, "placeholder" | "tall" | "menuSide" | "onSubmit">

/** 绘制 TipTap 输入区并保证空内容不可提交。 */
export function Composer({
  placeholder,
  tall,
  menuSide,
  model,
  modelOptions,
  onModel,
  account,
  accountOptions,
  onAccount,
  showAccount,
  depth,
  onDepth,
  permissionMode = "default",
  onPermissionMode,
  onSubmit,
  disabled = false,
  smartPunctuation,
}: ComposerProps) {
  const submitRef = useRef(onSubmit)
  submitRef.current = onSubmit
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled
  const submittingRef = useRef(false)
  const smartRef = useRef(smartPunctuation)
  smartRef.current = smartPunctuation
  const smartExtension = useMemo(() => createSmartPunctuation(() => smartRef.current), [])
  const editor = useEditor({
    immediatelyRender: true,
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      Placeholder.configure({ placeholder }),
      smartExtension,
    ],
    editorProps: {
      attributes: { class: "tiptap", "aria-label": "给 Claude 的消息" },
      handleKeyDown: (_view, event) => {
        const action = getComposerKeyAction(event.key, event.shiftKey)
        if (action === "ignore" || action === "newline") return false
        event.preventDefault()
        if (disabledRef.current) return true
        const text = _view.state.doc.textContent.trim()
        if (text) void submitText(text)
        return true
      },
    },
  })

  const modeLabel = permissionModes.find(([id]) => id === permissionMode)?.[1] ?? "每次询问"
  const depthLabel = thinkingDepths.find(([id]) => id === depth)?.[1] ?? "中"
  const modelLabel = modelOptions.find((item) => item.id === model)?.label ?? "默认模型"
  const accountLabel = accountOptions.find((item) => item.id === account)?.label ?? "自动选择账号"
  const empty = useEditorState({
    editor,
    selector: ({ editor: current }) => !current || current.isEmpty,
  })

  // 同一时间只允许一次提交；成功后清空编辑器，失败或拒绝时保留草稿。
  async function submitText(text: string): Promise<void> {
    if (submittingRef.current || disabledRef.current) return
    submittingRef.current = true
    try {
      await submitComposerText(text, submitRef.current, () => editor?.commands.clearContent())
    } catch {
      // 提交方负责展示错误；输入区只保留草稿。
    } finally {
      submittingRef.current = false
    }
  }

  return (
    <div className={tall ? "composer is-tall" : "composer"}>
      <EditorContent editor={editor} />
      <div className="composer-bar">
        <div className="composer-side">
          <Button
            variant="plain"
            className="icon-btn"
            type="button"
            aria-label="添加附件"
            title="添加附件"
          >
            <Icon name="plus" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger className="chip-btn">
              <Icon name="hand" small />
              {modeLabel}
              <Icon name="down" className="chip-caret" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side={menuSide} align="start">
              {permissionModes.map(([id, label, description]) => (
                <DropdownMenuItem key={id} onSelect={() => onPermissionMode?.(id)}>
                  <span className="grow">
                    <span>{label}</span>
                    <span className="muted" style={{ display: "block", fontSize: 12 }}>
                      {description}
                    </span>
                  </span>
                  {id === permissionMode ? <Icon name="check" small /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="composer-side end">
          {showAccount ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="chip-btn">
                <span className="dot ok" />
                <span className="chip-label-optional">{accountLabel}</span>
                <Icon name="down" className="chip-caret" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side={menuSide} align="end">
                {accountOptions.length === 0 ? (
                  <DropdownMenuItem disabled>没有可用账号</DropdownMenuItem>
                ) : null}
                {accountOptions.map((item) => (
                  <DropdownMenuItem key={item.id} onSelect={() => onAccount(item.id)}>
                    {item.label}
                    {item.id === account ? <Icon name="check" small /> : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {showAccount ? <span className="composer-sep" aria-hidden="true" /> : null}
          <DropdownMenu>
            <DropdownMenuTrigger className="chip-btn">
              {modelLabel}
              <Icon name="down" className="chip-caret" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side={menuSide} align="end">
              {modelOptions.length === 0 ? (
                <DropdownMenuItem disabled>模型列表不可用</DropdownMenuItem>
              ) : null}
              {modelOptions.map((item) => (
                <DropdownMenuItem key={item.id} onSelect={() => onModel(item.id)}>
                  {item.label}
                  {item.id === model ? <Icon name="check" small /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger className="chip-btn">
              <Icon name="clock" small />
              <span className="chip-label-optional">思考</span>
              {depthLabel}
              <Icon name="down" className="chip-caret" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side={menuSide} align="end">
              {thinkingDepths.map(([id, label]) => (
                <DropdownMenuItem key={id} onSelect={() => onDepth(id)}>
                  {label}
                  {id === depth ? <Icon name="check" small /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="plain"
            className="send"
            type="button"
            aria-label="发送"
            title="发送 ↩"
            aria-disabled={empty || disabled ? true : undefined}
            onClick={() => {
              if (disabled) return
              const text = editor?.getText().trim() ?? ""
              if (text) void submitText(text)
            }}
          >
            <Icon name="send" />
          </Button>
        </div>
      </div>
    </div>
  )
}
