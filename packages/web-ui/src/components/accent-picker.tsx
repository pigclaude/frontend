// 负责呈现共用主题色面板，支持预设、色相亮度调整、HEX 校验和恢复默认。
"use client"
import { useId, useState } from "react"
import { RadioGroup } from "radix-ui"
import { Button } from "./button"
import { Input } from "./input"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"
import { Slider } from "./slider"
import { useAccent } from "../lib/accent-hook"
import { ACCENT_PRESETS } from "../lib/accent-presets"
import { hexToOklch, oklchToHex } from "../lib/accent-color"
import { resetAccent } from "../lib/accent"
import { cn } from "../lib/utils"

/** 立即应用合法主题色，并同步所有已挂载选择器的逻辑选择。 */
export function AccentPicker({ className }: { className?: string }) {
  const [choice, apply] = useAccent()
  const [draft, setDraft] = useState<string | null>(null)
  const errorId = useId()
  const brand =
    choice.kind === "custom"
      ? choice.hex
      : ACCENT_PRESETS.find((preset) => preset.id === choice.id)!.brand
  const color = hexToOklch(brand)
  const hex = draft ?? brand
  const invalid = !/^#[0-9a-f]{6}$/i.test(hex)
  function adjust(next: { h?: number; l?: number }) {
    const hex = oklchToHex({ ...color, ...next })
    setDraft(null)
    apply({ kind: "custom", hex })
  }
  return (
    <Popover onOpenChange={() => setDraft(null)}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="主题色"
          title="主题色"
          data-accent={choice.kind === "preset" ? choice.id : choice.hex}
          className={cn(
            "size-[30px] rounded-full border border-border p-[6px] focus-visible:ring-ring",
            className,
          )}
        >
          <span
            aria-hidden
            className="size-full rounded-full"
            style={{
              background: `conic-gradient(from 35deg, ${brand}, color-mix(in srgb, ${brand} 45%, white), ${brand}, color-mix(in srgb, ${brand} 65%, black), ${brand})`,
            }}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label="主题色设置" className="w-[272px] space-y-4">
        <h2 className="text-sm font-semibold">主题色</h2>
        <RadioGroup.Root
          aria-label="主题色预设"
          value={choice.kind === "preset" ? choice.id : ""}
          onValueChange={(id) => {
            const preset = ACCENT_PRESETS.find((preset) => preset.id === id)
            if (preset) {
              setDraft(null)
              apply({ kind: "preset", id: preset.id })
            }
          }}
          className="grid grid-cols-4 gap-2"
        >
          {ACCENT_PRESETS.map((preset) => (
            <RadioGroup.Item
              key={preset.id}
              value={preset.id}
              aria-label={preset.label}
              title={preset.label}
              className="flex h-10 items-center justify-center rounded-md border border-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:border-foreground"
            >
              <span
                aria-hidden
                className="size-6 rounded-full border border-black/10"
                style={{ background: preset.brand }}
              />
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
        <div className="space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground">自定义</h3>
          <div className="flex items-center gap-3">
            <span className="w-8 shrink-0 text-xs">色相</span>
            <Slider
              aria-label="色相"
              min={0}
              max={360}
              step={1}
              value={[Math.round(color.h)]}
              onValueChange={([h]) => adjust({ h })}
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="w-8 shrink-0 text-xs">亮度</span>
            <Slider
              aria-label="亮度"
              min={0}
              max={100}
              step={1}
              value={[Math.round(color.l * 100)]}
              onValueChange={([l]) => adjust({ l: l / 100 })}
            />
          </div>
          <Input
            aria-label="HEX"
            aria-invalid={invalid}
            aria-describedby={invalid ? errorId : undefined}
            value={hex}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              const hex = event.target.value
              setDraft(hex)
              if (/^#[0-9a-f]{6}$/i.test(hex)) apply({ kind: "custom", hex: hex.toLowerCase() })
            }}
            className="font-mono text-sm"
          />
          {invalid && (
            <p id={errorId} role="alert" className="text-xs text-destructive">
              请输入 #RRGGBB
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => {
            setDraft(null)
            resetAccent()
          }}
        >
          恢复默认
        </Button>
      </PopoverContent>
    </Popover>
  )
}
