// 负责「高级」的前两组：磨砂透明度与对比度，界面、内容、代码三个字号。
import type { AppearanceController } from "../../../hooks/use-appearance"
import type { AppearanceSettings } from "../../../models/appearance-settings"
import { RangeControl } from "../setting-controls"
import { SettingRow, SettingSection } from "../setting-page"
import { NumberField } from "./number-field"

type NumberKey = "glass" | "contrast" | "uiSize" | "contentSize" | "codeSize"

const sizes: {
  key: "uiSize" | "contentSize" | "codeSize"
  title: string
  desc: string
  min: number
  max: number
}[] = [
  { key: "uiSize", title: "界面字号", desc: "调整 pigclaude 的基础字号", min: 11, max: 18 },
  { key: "contentSize", title: "内容字体大小", desc: "对话与正文使用的字号", min: 11, max: 20 },
  {
    key: "codeSize",
    title: "代码字体大小",
    desc: "对话和差异视图中代码使用的字号",
    min: 10,
    max: 18,
  },
]

/** 渲染磨砂、对比度和字号三组设置。没有系统磨砂时磨砂行置灰并改说明。 */
export function AdvancedLook({
  appearance,
  glassAvailable,
}: {
  appearance: AppearanceController
  glassAvailable: boolean
}) {
  const { settings, update } = appearance
  const set = (key: NumberKey) => (value: number) =>
    update((current): AppearanceSettings => ({ ...current, [key]: value }))
  return (
    <>
      <SettingSection className="tight">
        <SettingRow
          title="磨砂透明度"
          description={glassAvailable ? "窗口透出桌面的程度，0 为实心底色" : "当前系统不支持磨砂"}
        >
          <RangeControl
            label="磨砂透明度"
            value={settings.glass}
            min={0}
            max={100}
            step={1}
            unit=""
            disabled={!glassAvailable}
            onChange={set("glass")}
          />
        </SettingRow>
        <SettingRow title="对比度" description="细线、悬停与选中的深浅">
          <RangeControl
            label="对比度"
            value={settings.contrast}
            min={0}
            max={100}
            step={1}
            unit=""
            onChange={set("contrast")}
          />
        </SettingRow>
      </SettingSection>
      <SettingSection className="tight">
        {sizes.map((size) => (
          <SettingRow key={size.key} title={size.title} description={size.desc}>
            <NumberField
              label={size.title}
              value={settings[size.key]}
              range={{ min: size.min, max: size.max, step: 0.5 }}
              onChange={set(size.key)}
            />
          </SettingRow>
        ))}
      </SettingSection>
    </>
  )
}
