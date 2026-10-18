// 负责「高级」的后四组：动态效果与分别设置、字体样式、标点与全宽、差异标记与指针光标及 macOS 专属项。
import { useMemo } from "react"
import { Switch } from "../../../components/ui/switch"
import type { AppearanceController } from "../../../hooks/use-appearance"
import { isFontInstalled } from "../../../lib/font-detect"
import type { AppearanceSettings } from "../../../models/appearance-settings"
import {
  codeFontOptions,
  contentFontOptions,
  installedFontOptions,
  weightOptions,
} from "../../../models/font-options"
import { setSplitModes } from "../../../models/theme-editing"
import { Segmented } from "../setting-controls"
import { SettingRow, SettingSection } from "../setting-page"
import { ChoiceSelect } from "./choice-select"
import { DockIconPicker } from "./dock-icon-picker"

type Settings = AppearanceSettings

/** 渲染其余高级设置。Dock 图标与字体平滑只在 macOS（platform 为 darwin）显示。 */
export function AdvancedBehavior({
  appearance,
  platform,
}: {
  appearance: AppearanceController
  platform: string
}) {
  const { settings, update } = appearance
  const set =
    <K extends keyof Settings>(key: K) =>
    (value: Settings[K]) =>
      update((current): Settings => ({ ...current, [key]: value }))
  const codeFonts = useMemo(
    () => installedFontOptions(codeFontOptions, settings.codeFont, isFontInstalled),
    [settings.codeFont],
  )
  const mac = platform === "darwin"

  return (
    <>
      <SettingSection className="tight">
        <SettingRow title="减少动态效果" description="减少动画效果或匹配系统设置">
          <Segmented
            label="减少动态效果"
            value={settings.motion}
            onChange={set("motion")}
            options={[
              { value: "system", label: "系统" },
              { value: "on", label: "开启" },
              { value: "off", label: "关闭" },
            ]}
          />
        </SettingRow>
        <SettingRow title="分别设置浅色和深色模式" description="分别选择各自的主题、颜色和字体">
          <Switch
            aria-label="分别设置浅色和深色模式"
            checked={settings.splitModes}
            onCheckedChange={(on) => update((current) => setSplitModes(current, on))}
          />
        </SettingRow>
      </SettingSection>
      <SettingSection className="tight">
        <SettingRow title="界面字体样式">
          <ChoiceSelect
            label="界面字重"
            value={settings.uiWeight}
            options={weightOptions}
            width={80}
            onChange={set("uiWeight")}
          />
        </SettingRow>
        <SettingRow title="内容字体">
          <ChoiceSelect
            label="内容字体"
            value={settings.contentFont}
            options={contentFontOptions}
            width={140}
            onChange={set("contentFont")}
          />
          <ChoiceSelect
            label="内容字重"
            value={settings.contentWeight}
            options={weightOptions}
            width={80}
            onChange={set("contentWeight")}
          />
        </SettingRow>
        <SettingRow title="代码字体">
          <ChoiceSelect
            label="代码字体"
            value={settings.codeFont}
            options={codeFonts}
            width={140}
            onChange={set("codeFont")}
          />
          <ChoiceSelect
            label="代码字重"
            value={settings.codeWeight}
            options={weightOptions}
            width={80}
            onChange={set("codeWeight")}
          />
        </SettingRow>
      </SettingSection>
      <SettingSection className="tight">
        <SettingRow
          title="智能标点"
          description="在输入时自动设置引号、破折号、省略号、箭头和数学符号的格式"
        >
          <Switch
            aria-label="智能标点"
            checked={settings.smartPunctuation}
            onCheckedChange={set("smartPunctuation")}
          />
        </SettingRow>
        <SettingRow title="页面全宽显示" description="以全宽显示页面，仅影响你的视图">
          <Switch
            aria-label="页面全宽显示"
            checked={settings.fullWidth}
            onCheckedChange={set("fullWidth")}
          />
        </SettingRow>
      </SettingSection>
      <SettingSection className="tight">
        <SettingRow title="差异标记" description="使用颜色或 +/− 标记显示更改">
          <Segmented
            label="差异标记"
            value={settings.diffMarker}
            onChange={set("diffMarker")}
            options={[
              { value: "color", label: "颜色" },
              { value: "sign", label: "+/−" },
            ]}
          />
        </SettingRow>
        <SettingRow title="使用指针光标" description="悬停交互元素时切换为指针光标">
          <Switch
            aria-label="使用指针光标"
            checked={settings.pointerCursor}
            onCheckedChange={set("pointerCursor")}
          />
        </SettingRow>
        {mac ? (
          <SettingRow title="Dock 图标" description="选择应用在 Dock 中使用的图标">
            <DockIconPicker value={settings.dockIcon} onChange={set("dockIcon")} />
          </SettingRow>
        ) : null}
        {mac ? (
          <SettingRow title="字体平滑" description="使用 macOS 原生字体抗锯齿">
            <Switch
              aria-label="字体平滑"
              checked={settings.fontSmoothing}
              onCheckedChange={set("fontSmoothing")}
            />
          </SettingRow>
        ) : null}
      </SettingSection>
    </>
  )
}
