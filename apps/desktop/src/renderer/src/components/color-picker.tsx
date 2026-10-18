// 负责颜色选择器：圆色块加 HEX 的触发按钮，弹层里有饱和度/亮度方块、色相条、HEX 输入、取色笔、常用色和对比度说明。
import { type KeyboardEvent, useState } from "react"
import { contrastRatio, type Hex, parseHex } from "../models/color-math"
import {
  contrastNote,
  type Hsv,
  hsvFromHex,
  hsvHex,
  parseHexInput,
  syncHsv,
} from "../models/color-picker-model"
import { ColorHueSlider } from "./color-hue-slider"
import { ColorSvSquare } from "./color-sv-square"
import { Icon } from "./icon"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover"

type EyeDropperResult = { sRGBHex: string }
type EyeDropperConstructor = new () => { open: () => Promise<EyeDropperResult> }

function eyeDropper(): EyeDropperConstructor | null {
  return (window as Window & { EyeDropper?: EyeDropperConstructor }).EyeDropper ?? null
}

/** ColorPicker 的参数。against 是计算对比度用的另一侧颜色，低于 minContrast 时提示偏低。 */
export type ColorPickerProps = {
  label: string
  value: Hex
  against: Hex
  minContrast: number
  swatches?: readonly Hex[]
  defaultValue: Hex
  onChange: (value: Hex) => void
}

/**
 * 渲染颜色选择器。拖动、按键、输入、取色和点常用色时，颜色一变就调用 onChange，没有确认按钮；
 * onChange 只会收到合法的大写 HEX。内部记住色相，拖进黑色或灰色再拖回来不会丢色相；
 * value 从外部改变时按新值重新同步。
 */
export function ColorPicker({
  label,
  value,
  against,
  minContrast,
  swatches,
  defaultValue,
  onChange,
}: ColorPickerProps) {
  const fallback = parseHex(defaultValue) ?? "#000000"
  const current = parseHex(value) ?? fallback
  const [memory, setMemory] = useState<Hsv>(() => hsvFromHex(current))
  const [draft, setDraft] = useState<string | null>(null)
  const hsv = syncHsv(memory, current)
  const dropper = eyeDropper()
  const note = contrastNote(
    label,
    contrastRatio(current, parseHex(against) ?? current),
    minContrast,
  )
  const palette = (swatches ?? []).flatMap((swatch) => parseHex(swatch) ?? [])

  const applyHsv = (next: Hsv) => {
    setMemory(next)
    const hex = hsvHex(next)
    if (hex !== current) onChange(hex)
  }
  const applyHex = (hex: Hex) => {
    setMemory(syncHsv(hsv, hex))
    if (hex !== current) onChange(hex)
  }
  const commitDraft = () => {
    if (draft === null) return
    const hex = parseHexInput(draft)
    setDraft(null)
    if (hex) applyHex(hex)
  }
  const onDraftKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      commitDraft()
    }
  }
  const pickFromScreen = () => {
    if (!dropper) return
    new dropper()
      .open()
      .then((result) => {
        const hex = parseHexInput(result.sRGBHex)
        if (hex) applyHex(hex)
      })
      .catch(() => undefined)
  }

  return (
    <Popover onOpenChange={(open) => !open && commitDraft()}>
      <PopoverTrigger asChild>
        <Button className="cp-trigger" aria-label={`${label} ${current}`}>
          <span className="cp-dot" style={{ backgroundColor: current }} />
          <span className="mono">{current}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="cp" align="end" aria-label={label}>
        <ColorSvSquare label={label} hsv={hsv} onChange={applyHsv} />
        <ColorHueSlider label={label} hue={hsv.h} onChange={(h) => applyHsv({ ...hsv, h })} />
        <div className="cp-row">
          <span className="cp-preview" style={{ backgroundColor: current }} />
          <Input
            className="mono cp-hex"
            aria-label={`${label} HEX`}
            value={draft ?? current}
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitDraft}
            onKeyDown={onDraftKeyDown}
          />
          {dropper && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="从屏幕取色"
              title="从屏幕取色"
              onClick={pickFromScreen}
            >
              <Icon name="pipette" />
            </Button>
          )}
        </div>
        {palette.length > 0 && (
          <div className="cp-swatches">
            {palette.map((swatch) => (
              <Button
                key={swatch}
                type="button"
                variant="plain"
                className="cp-swatch"
                style={{ backgroundColor: swatch }}
                aria-label={swatch}
                title={swatch}
                aria-pressed={swatch === current}
                onClick={() => applyHex(swatch)}
              />
            ))}
          </div>
        )}
        <div className="cp-foot">
          <span className={note.low ? "cp-note is-low" : "cp-note"}>{note.text}</span>
          <Button type="button" size="sm" onClick={() => applyHex(fallback)}>
            <Icon name="undo" />
            默认
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
