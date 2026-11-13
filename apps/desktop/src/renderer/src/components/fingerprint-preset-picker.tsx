// 负责用分组下拉选择指纹预设；根据实际字段识别当前画像，手动修改后自动显示自定义配置。

import { desktopText } from "../locale/text"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import {
  advancedFingerprintProfiles,
  applyFingerprintPreset,
  fingerprintGroups,
  quickFingerprintPresets,
} from "../models/fingerprint-form"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./ui/select"

const presets = [...quickFingerprintPresets, ...advancedFingerprintProfiles]
const presetFields = fingerprintGroups
  .flatMap((group) => group.fields)
  .filter((key) => key !== "seed" && key !== "unknownArgs")

/** 选择后应用预设，并保留种子、自定义启动参数及旧记录中的兼容字段。 */
export function FingerprintPresetPicker({
  value,
  idPrefix,
  onChange,
}: {
  value: ClaudeFingerprintView
  idPrefix: string
  onChange: (value: ClaudeFingerprintView) => void
}) {
  const selected = presets.find((preset) =>
    presetFields.every((key) => {
      const current = value[key] ?? (key === "disableSpoofing" ? [] : "")
      return JSON.stringify(current) === JSON.stringify(preset.fingerprint[key])
    }),
  )

  return (
    <div className="fp-preset-picker">
      <Select
        value={selected?.id ?? "custom"}
        onValueChange={(next) => {
          const preset = presets.find((item) => item.id === next)
          if (preset) onChange(applyFingerprintPreset(value, preset))
        }}
      >
        <SelectTrigger
          id={`${idPrefix}-preset`}
          aria-label={desktopText("fingerprint.fingerprint-preset-picker.1")}
        >
          <SelectValue>
            {selected?.name ?? desktopText("fingerprint.fingerprint-preset-picker.2")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="fp-preset-menu">
          <SelectItem value="custom" disabled>
            {desktopText("fingerprint.fingerprint-preset-picker.3")}
          </SelectItem>
          <SelectSeparator />
          {[
            {
              label: desktopText("fingerprint.fingerprint-preset-picker.4"),
              items: quickFingerprintPresets,
            },
            {
              label: desktopText("fingerprint.fingerprint-preset-picker.5"),
              items: advancedFingerprintProfiles,
            },
          ].map((group) => (
            <SelectGroup key={group.label}>
              <SelectLabel>{group.label}</SelectLabel>
              {group.items.map((preset) => (
                <SelectItem
                  key={preset.id}
                  id={`${idPrefix}-preset-${preset.id}`}
                  value={preset.id}
                >
                  <span className="fp-preset-name">{preset.name}</span>
                  <span className="fp-preset-description">{preset.description}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
