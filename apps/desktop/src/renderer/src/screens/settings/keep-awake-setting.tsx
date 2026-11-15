// 显示本机手动唤醒偏好，主进程确认保存后更新开关。

import { useEffect, useState } from "react"
import { Switch } from "../../components/ui/switch"
import { useText } from "../../locale/text"
import { SettingRow, SettingSection } from "./setting-page"

/** 显示和修改保持电脑唤醒的手动偏好。 */
export function KeepAwakeSetting() {
  const { t } = useText()
  const bridge = window.pigclaude?.keepAwake
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    void bridge?.get().then(
      (value) => {
        if (live) setEnabled(value)
      },
      () => {
        if (live) setFailed(true)
      },
    )
    return () => {
      live = false
    }
  }, [bridge])

  async function save(next: boolean): Promise<void> {
    if (!bridge || saving) return
    setSaving(true)
    setFailed(false)
    try {
      setEnabled(await bridge.set(next))
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  if (!bridge) return null
  return (
    <SettingSection>
      <SettingRow title={t("appSettings.keepAwake")} description={t("appSettings.keepAwakeDetail")}>
        <Switch
          aria-label={t("appSettings.keepAwake")}
          checked={enabled ?? false}
          disabled={enabled === null || saving}
          onCheckedChange={(next) => void save(next)}
        />
      </SettingRow>
      {failed ? (
        <p role="alert" className="error-text">
          {t("appSettings.keepAwakeFailed")}
        </p>
      ) : null}
    </SettingSection>
  )
}
