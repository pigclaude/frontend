// 负责指纹的「自动、常用选项、自定义」控件，选择状态不写进指纹数据，外部草稿更新仍能正确回显。

import { useEffect, useRef, useState } from "react"
import type { FingerprintFieldOption } from "../models/fingerprint-fields"
import { generateFingerprintSeed } from "../models/fingerprint-choices"
import { Input } from "./ui/input"
import { Combobox } from "./ui/combobox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./ui/select"

/** 可选择常用值并保留任意现有值的受控指纹字段。 */
export function FingerprintChoice({
  id,
  label,
  value,
  defaultLabel,
  options,
  placeholder,
  numeric,
  mono,
  generateSeed,
  searchable,
  invalid,
  describedBy,
  onChange,
}: {
  id: string
  label: string
  value: string
  defaultLabel: string
  options: FingerprintFieldOption[]
  placeholder?: string | undefined
  numeric?: boolean
  mono?: boolean | undefined
  generateSeed?: boolean
  searchable?: boolean
  invalid: boolean
  describedBy?: string | undefined
  onChange: (value: string) => void
}) {
  const [customDraft, setCustomDraft] = useState<string | null>(null)
  const field = useRef<HTMLDivElement>(null)
  const focusCustom = useRef(false)
  const custom =
    customDraft === value || (value !== "" && !options.some((item) => item.value === value))
  const a11y = { "aria-invalid": invalid, "aria-describedby": describedBy }

  useEffect(() => {
    if (!focusCustom.current || !custom) return
    const input = field.current?.querySelector<HTMLInputElement>("input")
    if (!input) return
    focusCustom.current = false
    input.focus()
  }, [custom])

  function selectValue(next: string) {
    if (next === "__custom__") {
      focusCustom.current = true
      setCustomDraft(value)
    } else if (next === "__generate__") {
      focusCustom.current = true
      const seed = generateFingerprintSeed()
      setCustomDraft(seed)
      onChange(seed)
    } else {
      setCustomDraft(null)
      onChange(next === "__default__" ? "" : next)
    }
  }

  function restoreCustomFocus(event: Event) {
    if (!focusCustom.current) return
    event.preventDefault()
    const input = field.current?.querySelector<HTMLInputElement>("input")
    if (input) {
      focusCustom.current = false
      input.focus()
    }
  }

  return (
    <div className="fp-choice" ref={field}>
      {searchable ? (
        <Combobox
          id={id}
          label={label}
          value={custom ? "__custom__" : value || "__default__"}
          options={[
            {
              value: "__default__",
              label: defaultLabel,
              keywords: ["默认", "自动", "default", "auto", "system"],
            },
            ...options,
          ]}
          customOption={{ value: "__custom__", label: "自定义…" }}
          invalid={invalid}
          describedBy={describedBy}
          onValueChange={selectValue}
          onCloseAutoFocus={restoreCustomFocus}
        />
      ) : (
        <Select value={custom ? "__custom__" : value || "__default__"} onValueChange={selectValue}>
          <SelectTrigger id={id} {...a11y}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="fp-select-menu" onCloseAutoFocus={restoreCustomFocus}>
            <SelectItem value="__default__">{defaultLabel}</SelectItem>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
            <SelectSeparator />
            {generateSeed ? <SelectItem value="__generate__">生成新种子</SelectItem> : null}
            <SelectItem value="__custom__">自定义…</SelectItem>
          </SelectContent>
        </Select>
      )}
      {custom ? (
        <Input
          id={`${id}-custom`}
          aria-label={`自定义${label}`}
          autoFocus={focusCustom.current}
          value={value}
          placeholder={placeholder}
          className={mono ? "mono" : undefined}
          inputMode={numeric ? "numeric" : undefined}
          spellCheck={false}
          {...a11y}
          onChange={(event) => {
            setCustomDraft(event.target.value)
            onChange(event.target.value)
          }}
        />
      ) : null}
    </div>
  )
}
