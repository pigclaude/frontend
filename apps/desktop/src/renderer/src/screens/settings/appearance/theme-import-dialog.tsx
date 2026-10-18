// 负责导入主题对话框：粘贴 JSON 或选择 .json 文件，实时校验并预览浅色、深色两组色卡，确认后交给调用方保存。
import { useRef, useState } from "react"
import { Button } from "../../../components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../../components/ui/dialog"
import { Textarea } from "../../../components/ui/textarea"
import { parseThemeFile } from "../../../models/theme-file"
import type { ThemeColors, ThemeDefinition } from "../../../models/theme-presets"

const placeholder = `{
  "schema": "pigclaude-theme/1",
  "name": "我的蓝",
  "light": { "bg": "#FFFFFF", "fg": "#0D0D0D", "accent": "#0169CC" },
  "dark": { "bg": "#181818", "fg": "#FFFFFF", "accent": "#339CFF" }
}`

function Swatches({ label, colors }: { label: string; colors: ThemeColors }) {
  const entries: [string, string | undefined][] = [
    ["背景", colors.bg],
    ["强调色", colors.accent],
    ["前景", colors.fg],
  ]
  return (
    <div className="import-swatches">
      <span className="import-swatches-label">{label}</span>
      {entries.map(([name, hex]) => (
        <span key={name} className="import-swatch" title={`${name} ${hex ?? "默认"}`}>
          <span
            className={hex ? "cp-dot" : "cp-dot is-default"}
            style={hex ? { backgroundColor: hex } : undefined}
          />
          <span className="mono">{hex ?? "默认"}</span>
        </span>
      ))}
    </div>
  )
}

/** 渲染导入对话框。existingNames 用来给重名主题加序号；只有解析成功时「导入」可点。 */
export function ThemeImportDialog({
  open,
  existingNames,
  onOpenChange,
  onImport,
}: {
  open: boolean
  existingNames: readonly string[]
  onOpenChange: (open: boolean) => void
  onImport: (theme: ThemeDefinition) => void
}) {
  const [text, setText] = useState("")
  const [fileError, setFileError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const result = text.trim() ? parseThemeFile(text, existingNames) : null
  const close = (next: boolean) => {
    if (!next) {
      setText("")
      setFileError(null)
    }
    onOpenChange(next)
  }
  const readFile = (file: File | undefined) => {
    if (!file) return
    file
      .text()
      .then((content) => {
        setFileError(null)
        setText(content)
      })
      .catch(() => setFileError("读不了这个文件"))
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="wide">
        <div className="dialog-head">
          <DialogTitle>导入主题</DialogTitle>
          <DialogDescription>
            粘贴主题 JSON，或选择一个 .json 文件。导入后加入「我的主题」。
          </DialogDescription>
        </div>
        <div className="dialog-body">
          <Textarea
            className="mono import-text"
            aria-label="主题 JSON"
            placeholder={placeholder}
            spellCheck={false}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="import-file-row">
            <Button size="sm" onClick={() => fileInput.current?.click()}>
              选择文件…
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(event) => {
                readFile(event.target.files?.[0])
                event.target.value = ""
              }}
            />
          </div>
          {fileError ? <p className="import-error">{fileError}</p> : null}
          {result && !result.ok ? (
            <p className="import-error" role="alert">
              {result.reason}
            </p>
          ) : null}
          {result?.ok ? (
            <div className="import-preview" aria-label="预览">
              <b>{result.theme.name}</b>
              {result.theme.light ? <Swatches label="浅色" colors={result.theme.light} /> : null}
              {result.theme.dark ? <Swatches label="深色" colors={result.theme.dark} /> : null}
            </div>
          ) : null}
        </div>
        <div className="dialog-foot">
          <Button variant="ghost" onClick={() => close(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={!result?.ok}
            onClick={() => {
              if (!result?.ok) return
              onImport(result.theme)
              close(false)
            }}
          >
            导入
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
