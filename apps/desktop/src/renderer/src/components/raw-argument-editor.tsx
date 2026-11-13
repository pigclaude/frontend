// 负责逐项编辑含换行或单独空项的原始启动参数，保留换行类型与参数边界。

import { desktopText } from "../locale/text"
import { Fragment, useLayoutEffect, useRef } from "react"
import { Button } from "./ui/button"
import { Textarea } from "./ui/textarea"

type FocusTarget = { argument: number; line: number; offset?: number } | "add"

/** 按参数和原始换行边界编辑，删除时把焦点移到相邻项或添加按钮。 */
export function RawArgumentEditor({
  id,
  args,
  placeholder,
  invalid,
  describedBy,
  onChange,
}: {
  id: string
  args: string[]
  placeholder?: string | undefined
  invalid: boolean
  describedBy?: string | undefined
  onChange: (args: string[]) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<FocusTarget | null>(null)

  useLayoutEffect(() => {
    const target = pendingFocus.current
    if (target === null) return
    pendingFocus.current = null
    if (target === "add") {
      container.current?.querySelector<HTMLButtonElement>("[data-raw-add]")?.focus()
      return
    }
    const field = container.current?.querySelector<HTMLTextAreaElement>(
      `[data-raw-argument="${target.argument}"][data-raw-line="${target.line}"]`,
    )
    field?.focus()
    if (field && target.offset !== undefined) field.setSelectionRange(target.offset, target.offset)
  }, [args])

  function replaceArgument(index: number, next: string) {
    onChange(args.map((arg, position) => (position === index ? next : arg)))
  }

  return (
    <div className="fp-argument-list" ref={container}>
      {args.map((arg, argument) => {
        const parts = arg.split(/(\r\n|\r|\n)/)
        const lines = parts.filter((_part, index) => index % 2 === 0)
        return (
          <div className="fp-argument-entry" key={argument}>
            <div className="fp-argument-parts">
              {lines.map((line, lineIndex) => {
                const separator = parts[lineIndex * 2 + 1]
                const fieldId =
                  argument === 0 && lineIndex === 0
                    ? id
                    : lineIndex === 0
                      ? `${id}-${argument + 1}`
                      : `${id}-${argument + 1}-line-${lineIndex + 1}`
                return (
                  <Fragment key={lineIndex}>
                    <Textarea
                      id={fieldId}
                      data-raw-argument={argument}
                      data-raw-line={lineIndex}
                      aria-label={desktopText("fingerprintExtra.raw-argument-editor.1", {
                        value1: String(argument + 1),
                        value2: String(lineIndex + 1),
                      })}
                      aria-invalid={invalid}
                      aria-describedby={describedBy}
                      className="mono fp-arguments"
                      value={line}
                      placeholder={placeholder}
                      spellCheck={false}
                      onChange={(event) => {
                        const nextLine = event.target.value
                        const beforeCaret = nextLine.slice(0, event.target.selectionStart)
                        const enteredLines = beforeCaret.split(/\r\n|\r|\n/)
                        if (enteredLines.length > 1) {
                          pendingFocus.current = {
                            argument,
                            line: lineIndex + enteredLines.length - 1,
                            offset: enteredLines.at(-1)?.length ?? 0,
                          }
                        }
                        const nextParts = [...parts]
                        nextParts[lineIndex * 2] = nextLine
                        replaceArgument(argument, nextParts.join(""))
                      }}
                    />
                    {separator ? (
                      <div className="fp-line-break">
                        <span>
                          {desktopText("fingerprintExtra.raw-argument-editor.2")}
                          {separator === "\r\n" ? "CRLF" : separator === "\r" ? "CR" : "LF"}）
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={desktopText("fingerprintExtra.raw-argument-editor.3", {
                            value1: String(argument + 1),
                            value2: String(lineIndex + 1),
                          })}
                          onClick={() => {
                            pendingFocus.current = {
                              argument,
                              line: lineIndex,
                              offset: line.length,
                            }
                            replaceArgument(
                              argument,
                              parts.filter((_part, index) => index !== lineIndex * 2 + 1).join(""),
                            )
                          }}
                        >
                          {desktopText("fingerprintExtra.raw-argument-editor.4")}
                        </Button>
                      </div>
                    ) : null}
                  </Fragment>
                )
              })}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={desktopText("fingerprintExtra.raw-argument-editor.5", {
                value1: String(argument + 1),
              })}
              onClick={() => {
                pendingFocus.current =
                  args.length === 1
                    ? "add"
                    : { argument: Math.min(argument, args.length - 2), line: 0 }
                onChange(args.filter((_arg, index) => index !== argument))
              }}
            >
              {desktopText("fingerprintExtra.raw-argument-editor.6")}
            </Button>
          </div>
        )
      })}
      <Button
        id={args.length === 0 ? id : undefined}
        data-raw-add
        type="button"
        variant="ghost"
        size="sm"
        aria-label={desktopText("fingerprintExtra.raw-argument-editor.7")}
        onClick={() => {
          pendingFocus.current = { argument: args.length, line: 0 }
          onChange([...args, ""])
        }}
      >
        {desktopText("fingerprintExtra.raw-argument-editor.8")}
      </Button>
    </div>
  )
}
