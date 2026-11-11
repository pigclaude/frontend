// 负责基于 shadcn Popover 与 Command 的可搜索组合框，搜索文字不写入受控配置值。

import { useState } from "react"
import { Icon } from "../icon"
import { Button } from "./button"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./command"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

/** 一个组合框选项；关键词可补充别名而不影响展示文字和最终保存值。 */
export type ComboboxOption = { value: string; label: string; keywords?: string[] | undefined }

/** 提供名称、代码搜索与自定义入口，选择后关闭，重新打开时清空上次搜索。 */
export function Combobox({
  id,
  label,
  value,
  options,
  customOption,
  invalid,
  describedBy,
  onValueChange,
  onCloseAutoFocus,
}: {
  id: string
  label: string
  value: string
  options: ComboboxOption[]
  customOption: ComboboxOption
  invalid?: boolean
  describedBy?: string | undefined
  onValueChange: (value: string) => void
  onCloseAutoFocus?: (event: Event) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const selected = options.find((option) => option.value === value) ?? customOption

  function select(next: string) {
    onValueChange(next)
    setOpen(false)
    setSearch("")
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setSearch("")
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="plain"
          id={id}
          className="select-trigger"
          data-slot="combobox-trigger"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault()
              setSearch("")
              setOpen(true)
            }
          }}
        >
          <span className="select-trigger-value">{selected.label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="combobox-popover"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <Command loop label={`搜索${label}`} defaultValue={value}>
          <CommandInput
            aria-label={`搜索${label}`}
            placeholder="搜索名称或代码…"
            value={search}
            onValueChange={setSearch}
            autoComplete="off"
            spellCheck={false}
          />
          <CommandList>
            <CommandEmpty>未找到匹配项</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.value}
                value={option.value}
                keywords={[option.label, ...(option.keywords ?? [])]}
                onSelect={() => select(option.value)}
              >
                <span>{option.label}</span>
                {value === option.value ? (
                  <span className="check-mark">
                    <Icon name="check" small />
                  </span>
                ) : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
        <div className="combobox-footer">
          <Button variant="plain" className="menu-item" onClick={() => select(customOption.value)}>
            <Icon name="pencil" small />
            {customOption.label}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
