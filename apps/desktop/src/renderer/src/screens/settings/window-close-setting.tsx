// 负责托盘与菜单栏页的关窗偏好，通过桌面桥读取和保存。

import { useEffect, useState } from "react"
import { Switch } from "../../components/ui/switch"
import { desktopText } from "../../locale/text"
import { SettingRow } from "./setting-page"

/** 显示主进程实际采用的关窗设置；保存失败时保留原状态。 */
export function WindowCloseSetting() {
  const bridge = window.pigclaude?.window
  const [value, setValue] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    void bridge?.getCloseToTray?.().then(
      (next) => {
        if (active) setValue(next)
      },
      () => {
        if (active) setFailed(true)
      },
    )
    return () => {
      active = false
    }
  }, [bridge])

  const label = desktopText("settings.windowCloseToTray")
  async function update(next: boolean): Promise<void> {
    if (!bridge?.setCloseToTray || saving) return
    setSaving(true)
    setFailed(false)
    try {
      setValue(await bridge.setCloseToTray(next))
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingRow
      title={label}
      description={desktopText(
        failed ? "settings.windowCloseToTrayFailed" : "settings.windowCloseToTrayDetail",
      )}
      value={value === null ? "—" : undefined}
    >
      {value === null ? null : (
        <Switch
          checked={value}
          disabled={saving}
          aria-label={label}
          onCheckedChange={(next) => void update(next)}
        />
      )}
    </SettingRow>
  )
}
