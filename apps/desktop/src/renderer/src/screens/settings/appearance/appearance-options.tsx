// 保留 PigClaude 旧外观中可独立设置的正文字体、字重和交互显示项。
import {
  fontDisplayName,
  fontFromDisplayName,
  Input,
  SegmentedControl,
  SettingRow,
  Switch,
  type AppearanceController,
  type AppearanceSettings,
} from "@pigclaude/ui-primitives"
import { useText, type TextKey } from "../../../locale/text"

/** 显示 Pigcode 外观页未提供的 PigClaude 本机偏好。 */
export function AppearanceOptions({ appearance }: { appearance: AppearanceController }) {
  const { t } = useText()
  const { settings, update } = appearance
  const set = <K extends keyof AppearanceSettings>(key: K, value: AppearanceSettings[K]) =>
    update((current) => ({ ...current, [key]: value }))
  const weights = [
    { value: "regular" as const, label: t("appearance.weight.regular") },
    { value: "medium" as const, label: t("appearance.weight.medium") },
  ]
  const weightFields = ["uiWeight", "contentWeight", "codeWeight"] as const
  const switches = ["fullWidth", "pointerCursor"] as const

  return (
    <>
      <SettingRow title={t("appearance.contentFont")}>
        <SegmentedControl
          aria-label={t("appearance.contentFont")}
          value={settings.contentFont}
          options={[
            { value: "same", label: t("appearance.contentFont.same") },
            { value: "serif", label: t("appearance.contentFont.serif") },
            { value: "rounded", label: t("appearance.contentFont.rounded") },
          ]}
          onValueChange={(value) => set("contentFont", value)}
        />
      </SettingRow>
      {settings.splitModes
        ? (["light", "dark"] as const).map((mode) => {
            const key: TextKey = mode === "light" ? "appearance.lightFont" : "appearance.darkFont"
            return (
              <SettingRow key={mode} title={t(key)}>
                <Input
                  aria-label={t(key)}
                  defaultValue={fontDisplayName("ui", settings[mode].uiFont)}
                  key={settings[mode].uiFont}
                  onBlur={(event) => {
                    const uiFont = fontFromDisplayName("ui", event.currentTarget.value)
                    update((current) => ({ ...current, [mode]: { ...current[mode], uiFont } }))
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur()
                  }}
                />
              </SettingRow>
            )
          })
        : null}
      {weightFields.map((key) => (
        <SettingRow key={key} title={t(`appearance.${key}`)}>
          <SegmentedControl
            aria-label={t(`appearance.${key}`)}
            value={settings[key]}
            options={weights}
            onValueChange={(value) => set(key, value)}
          />
        </SettingRow>
      ))}
      <SettingRow title={t("appearance.diffMarker")}>
        <SegmentedControl
          aria-label={t("appearance.diffMarker")}
          value={settings.diffMarker}
          options={[
            { value: "color", label: t("appearance.diffMarker.color") },
            { value: "sign", label: "+/−" },
          ]}
          onValueChange={(value) => set("diffMarker", value)}
        />
      </SettingRow>
      {switches.map((key) => (
        <SettingRow key={key} title={t(`appearance.${key}`)}>
          <Switch
            aria-label={t(`appearance.${key}`)}
            checked={settings[key]}
            onCheckedChange={(value) => set(key, value)}
          />
        </SettingRow>
      ))}
    </>
  )
}
