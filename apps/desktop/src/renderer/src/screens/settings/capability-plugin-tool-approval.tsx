// 显示已安装能力插件的逐次询问偏好，单个设置行也供插件详情复用。

import { useEffect, useState } from "react"
import type {
  CapabilityPluginsBridge,
  CapabilityPluginToolApproval,
  InstalledCapabilityPlugin,
} from "../../../../capability-plugin-contract"
import { fill, useText } from "../../locale/text"
import { Segmented } from "./setting-controls"
import { SettingRow, SettingSection } from "./setting-page"

/** 一个插件的工具询问偏好；调用方负责通过主进程保存。 */
export function CapabilityPluginToolApprovalRow({
  plugin,
  saving = false,
  onChange,
}: {
  plugin: Pick<InstalledCapabilityPlugin, "manifest" | "toolApproval">
  saving?: boolean
  onChange: (mode: CapabilityPluginToolApproval) => void
}) {
  const { t } = useText()
  const { id, name } = plugin.manifest
  return (
    <SettingRow title={name} description={`${id} · ${t("capabilityPluginTools.description")}`}>
      <Segmented<CapabilityPluginToolApproval>
        label={fill(t("capabilityPluginTools.label"), { plugin: name })}
        value={plugin.toolApproval}
        disabled={saving}
        onChange={onChange}
        options={[
          { value: "always_ask", label: t("capabilityPluginTools.alwaysAsk") },
          { value: "follow_session", label: t("capabilityPluginTools.followSession") },
        ]}
      />
    </SettingRow>
  )
}

/** 在会话设置中列出提供工具的能力插件，保存成功后显示进程确认的值。 */
export function CapabilityPluginToolApprovalSettings({
  bridge,
}: {
  bridge: CapabilityPluginsBridge
}) {
  const { t } = useText()
  const [plugins, setPlugins] = useState<InstalledCapabilityPlugin[]>([])
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let generation = 0
    const refresh = () => {
      const read = ++generation
      void bridge
        .list()
        .then((next) => {
          if (read === generation)
            setPlugins(
              next.filter(
                (plugin): plugin is InstalledCapabilityPlugin =>
                  plugin.type === "capability" && plugin.manifest.tools.length > 0,
              ),
            )
        })
        .catch(() => undefined)
    }
    const unsubscribe = bridge.subscribe(refresh)
    refresh()
    return () => {
      generation += 1
      unsubscribe()
    }
  }, [bridge])

  async function save(id: string, mode: CapabilityPluginToolApproval): Promise<void> {
    setSaving(true)
    setFailed(false)
    try {
      const updated = await bridge.setToolApproval(id, mode)
      setPlugins((current) =>
        current.map((plugin) => (plugin.manifest.id === id ? updated : plugin)),
      )
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  if (plugins.length === 0) return null
  return (
    <SettingSection title={t("capabilityPluginTools.title")}>
      {plugins.map((plugin) => (
        <CapabilityPluginToolApprovalRow
          key={plugin.manifest.id}
          plugin={plugin}
          saving={saving}
          onChange={(mode) => void save(plugin.manifest.id, mode)}
        />
      ))}
      {failed ? <p role="alert">{t("capabilityPluginTools.saveFailed")}</p> : null}
    </SettingSection>
  )
}
