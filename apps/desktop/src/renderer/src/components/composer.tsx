// 负责会话输入区：TipTap 正文、权限模式、账号、模型和思考深度菜单。
import { Placeholder } from "@tiptap/extension-placeholder"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { useMemo, useRef } from "react"
import { Icon } from "./icon"
import { createSmartPunctuation } from "./smart-punctuation"
import {
  composerModels,
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

const accounts = ["主力 Max", "备用 Pro"] as const

/** 会话输入区 props。 */
export type ComposerProps = {
  placeholder: string
  tall?: boolean
  menuSide: "top" | "bottom"
  model: string
  onModel: (model: string) => void
  account: string
  onAccount: (account: string) => void
  showAccount: boolean
  depth: ThinkingDepth
  onDepth: (depth: ThinkingDepth) => void
  permissionMode?: PermissionMode
  onPermissionMode?: (mode: PermissionMode) => void
  onSubmit: (text: string) => void
  smartPunctuation: boolean
}

/** 绘制 TipTap 输入区并保证空内容不可提交。 */
export function Composer({
  placeholder,
  tall,
  menuSide,
  model,
  onModel,
  account,
  onAccount,
  showAccount,
  depth,
  onDepth,
  permissionMode = "ask",
  onPermissionMode,
  onSubmit,
  smartPunctuation,
}: ComposerProps) {
  const submitRef = useRef(onSubmit)
  submitRef.current = onSubmit
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
        const text = _view.state.doc.textContent.trim()
        if (text) submitRef.current(text)
        return true
      },
    },
  })

  const modeLabel = permissionModes.find(([id]) => id === permissionMode)?.[1] ?? "每次询问"
  const depthLabel = thinkingDepths.find(([id]) => id === depth)?.[1] ?? "中"
  const empty = useEditorState({
    editor,
    selector: ({ editor: current }) => !current || current.isEmpty,
  })

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
                <span className="chip-label-optional">{account}</span>
                <Icon name="down" className="chip-caret" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side={menuSide} align="end">
                {accounts.map((item) => (
                  <DropdownMenuItem key={item} onSelect={() => onAccount(item)}>
                    {item}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {showAccount ? <span className="composer-sep" aria-hidden="true" /> : null}
          <DropdownMenu>
            <DropdownMenuTrigger className="chip-btn">
              {model}
              <Icon name="down" className="chip-caret" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side={menuSide} align="end">
              {composerModels.map((item) => (
                <DropdownMenuItem key={item} onSelect={() => onModel(item)}>
                  {item}
                  {item === model ? <Icon name="check" small /> : null}
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
            aria-disabled={empty ? true : undefined}
            onClick={() => {
              const text = editor?.getText().trim() ?? ""
              if (text) onSubmit(text)
            }}
          >
            <Icon name="send" />
          </Button>
        </div>
      </div>
    </div>
  )
}
