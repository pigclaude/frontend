// 使用 PigClaude 控件显示能力插件的声明式设置；回读密钥只显示配置状态。
import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@pigclaude/ui-primitives"
import type {
  CapabilityPluginSetting,
  CapabilityPluginSettingsView,
  CapabilityPluginSettingValue,
  CapabilityPluginsBridge,
  InstalledCapabilityPlugin,
} from "../../../../capability-plugin-contract"
import { fill, useText } from "../../locale/text"
import { SettingRow, SettingSection } from "./setting-page"
import "../../styles/capability-plugin-settings.css"

type SettingsBridge = Pick<CapabilityPluginsBridge, "readSettings" | "setSetting">
type Status = "loading" | "idle" | "saving" | "saved" | "error" | "storage-unavailable"

/** 给插件详情页提供可选的设置区域；停用或不兼容时不呈现声明的字段。 */
export function CapabilityPluginSettingsForm({ plugin }: { plugin: InstalledCapabilityPlugin }) {
  const bridge = window.pigclaude?.capabilityPlugins
  if (!plugin.enabled || !plugin.compatible || plugin.manifest.settings.length === 0 || !bridge)
    return null
  return <PluginSettings key={plugin.revision} plugin={plugin} bridge={bridge} />
}

function PluginSettings({
  plugin,
  bridge,
}: {
  plugin: InstalledCapabilityPlugin
  bridge: SettingsBridge
}) {
  const { t } = useText()
  const { id: pluginId, settings } = plugin.manifest
  const { revision } = plugin
  const [savedForm, resetForm] = useState(0)
  const [view, setView] = useState<CapabilityPluginSettingsView>()
  const [status, setStatus] = useState<Status>("loading")
  useEffect(() => {
    let current = true
    void bridge.readSettings({ pluginId, revision }).then(
      (data) => {
        if (current) {
          setView(data)
          setStatus("idle")
        }
      },
      (error: unknown) => {
        if (current) setStatus(errorStatus(error))
      },
    )
    return () => {
      current = false
    }
  }, [bridge, pluginId, revision])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!view || status === "saving") return
    const form = event.currentTarget
    const data = new FormData(form)
    const passwords = [...form.querySelectorAll<HTMLInputElement>('input[type="password"]')]
    setStatus("saving")
    try {
      for (const field of settings) {
        const value = formValue(data, field)
        if (value === initialValue(view, field)) continue
        setView(await bridge.setSetting({ pluginId, revision }, field.key, value))
        if (field.type === "secret") {
          const input = passwords.find((password) => password.name === field.key)
          if (input) input.value = ""
        }
      }
      resetForm((version) => version + 1)
      setStatus("saved")
    } catch (error: unknown) {
      setStatus(errorStatus(error))
    }
  }

  async function clearSecret(key: string) {
    if (status === "saving") return
    setStatus("saving")
    try {
      setView(await bridge.setSetting({ pluginId, revision }, key, null))
      setStatus("saved")
    } catch (error: unknown) {
      setStatus(errorStatus(error))
    }
  }

  return (
    <SettingSection title={t("capabilityPlugins.settings")} plain>
      {status === "loading" ? <p role="status">{t("capabilityPlugins.loading")}</p> : null}
      {view ? (
        <form key={savedForm} onSubmit={(event) => void save(event)}>
          <fieldset className="capability-plugin-settings-fields" disabled={status === "saving"}>
            <div className="group">
              {settings.map((field) => {
                const configured = view.configuredSecrets.includes(field.key)
                return (
                  <SettingRow key={field.key} title={field.label} description={field.description}>
                    <SettingInput
                      field={field}
                      value={storedValue(view, field.key)}
                      optionEmpty={t("capabilityPlugins.optionEmpty")}
                      secretStatus={t(
                        configured
                          ? "capabilityPlugins.secretConfigured"
                          : "capabilityPlugins.secretNotConfigured",
                      )}
                    />
                    {field.type === "secret" && configured ? (
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={fill(t("capabilityPlugins.clearSecretField"), {
                          field: field.label,
                        })}
                        onClick={() => void clearSecret(field.key)}
                      >
                        {t("capabilityPlugins.clearSecret")}
                      </Button>
                    ) : null}
                  </SettingRow>
                )
              })}
            </div>
            <div className="section-actions">
              <Button type="submit">{t("capabilityPlugins.save")}</Button>
              {status === "saved" ? (
                <span role="status" className="hint">
                  {t("capabilityPlugins.saved")}
                </span>
              ) : null}
            </div>
          </fieldset>
        </form>
      ) : null}
      {status === "error" || status === "storage-unavailable" ? (
        <p role="alert" className="error-text">
          {t(
            status === "error"
              ? "capabilityPlugins.settingsFailed"
              : "capabilityPlugins.secretStorageUnavailable",
          )}
        </p>
      ) : null}
    </SettingSection>
  )
}

function SettingInput({
  field,
  value,
  optionEmpty,
  secretStatus,
}: {
  field: CapabilityPluginSetting
  value: CapabilityPluginSettingValue | undefined
  optionEmpty: string
  secretStatus: string
}) {
  const attrs = { name: field.key, "aria-label": field.label }
  if (field.type === "boolean")
    return <input {...attrs} type="checkbox" defaultChecked={value === true} />
  if (field.type === "select") {
    return (
      <select
        {...attrs}
        className="input"
        defaultValue={typeof value === "string" ? value : ""}
        required={field.required}
      >
        <option value="">{optionEmpty}</option>
        {field.options.map(({ label, value }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    )
  }
  if (field.type === "secret") {
    return (
      <input
        {...attrs}
        className="input"
        type="password"
        autoComplete="new-password"
        placeholder={secretStatus}
        maxLength={4_096}
      />
    )
  }
  if (field.type === "number")
    return (
      <input
        {...attrs}
        className="input"
        type="number"
        step="any"
        defaultValue={typeof value === "number" ? value : ""}
        required={field.required}
      />
    )
  return (
    <input
      {...attrs}
      className="input"
      type="text"
      defaultValue={typeof value === "string" ? value : ""}
      maxLength={4_096}
      required={field.required}
    />
  )
}

function storedValue(view: CapabilityPluginSettingsView, key: string) {
  return Object.hasOwn(view.values, key) ? view.values[key] : undefined
}

function initialValue(view: CapabilityPluginSettingsView, field: CapabilityPluginSetting) {
  const stored = storedValue(view, field.key)
  if (stored !== undefined) return stored
  if (field.type === "text" || field.type === "secret") return ""
  if (field.type === "boolean") return false
  return null
}

function formValue(data: FormData, field: CapabilityPluginSetting): CapabilityPluginSettingValue {
  const entry = data.get(field.key)
  const raw = typeof entry === "string" ? entry : ""
  switch (field.type) {
    case "boolean":
      return data.has(field.key)
    case "number":
      return raw === "" ? null : Number(raw)
    case "select":
      return raw === "" ? null : raw
    default:
      return raw
  }
}

function errorStatus(error: unknown): Status {
  return error instanceof Error && error.message.includes("PLUGIN_SECRET_STORAGE_UNAVAILABLE")
    ? "storage-unavailable"
    : "error"
}
