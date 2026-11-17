// 管理本地来源选择、归档校验值、安装披露和单次确认的完整交互。

import { useEffect, useId, useRef, useState } from "react"
import { ChevronDown, Download, FolderOpen, Plus } from "lucide-react"
import { Button, InstallDialog, Menu } from "@pigclaude/ui-primitives"
import type {
  CapabilityPluginInstallSource,
  CapabilityPluginsBridge,
  DesktopPluginInstallDisclosure,
} from "../../../../capability-plugin-contract"
import { useText, type TextKey } from "../../locale/text"
import { PluginInstallDisclosure } from "./plugin-install-disclosure"
import { pluginInstallDisclosure, pluginSettingsError } from "./plugin-settings-view"

type InstallStep =
  | { kind: "archive"; path: string }
  | { kind: "disclosure"; prepared: DesktopPluginInstallDisclosure }

type InstallOwner = { closed: boolean; busy: boolean; preparedId: string | null }

function cancelPrepared(bridge: CapabilityPluginsBridge, confirmationId: string): void {
  void bridge.cancel(confirmationId).catch(() => undefined)
}

/** 只在安装可用时挂载，离开页面或会员变化时撤回本次未确认的包。 */
export function PluginInstallControls({
  bridge,
  developerMode,
  onError,
  onInstalled,
}: {
  bridge: CapabilityPluginsBridge
  developerMode: boolean
  onError: (error: TextKey | null) => void
  onInstalled: () => void
}) {
  const { t } = useText()
  const [step, setStep] = useState<InstallStep | null>(null)
  const [busy, setBusy] = useState(false)
  const digestId = useId()
  const owner = useRef<InstallOwner | null>(null)

  useEffect(() => {
    const current: InstallOwner = { closed: false, busy: false, preparedId: null }
    owner.current = current
    setStep(null)
    setBusy(false)
    return () => {
      current.closed = true
      owner.current = null
      if (current.preparedId) cancelPrepared(bridge, current.preparedId)
    }
  }, [bridge])

  async function run(
    operate: (current: InstallOwner) => Promise<void>,
    reportInForm = false,
  ): Promise<void> {
    const current = owner.current
    if (!current || current.busy) return
    current.busy = true
    setBusy(true)
    onError(null)
    try {
      await operate(current)
    } catch (cause: unknown) {
      if (current.closed) return
      const error = pluginSettingsError(cause)
      if (reportInForm) throw new Error(t(error))
      onError(error)
    } finally {
      current.busy = false
      if (!current.closed) setBusy(false)
    }
  }

  async function prepare(current: InstallOwner, source: CapabilityPluginInstallSource) {
    const prepared = await bridge.prepare(source)
    if (current.closed) {
      cancelPrepared(bridge, prepared.confirmationId)
      return
    }
    current.preparedId = prepared.confirmationId
    setStep({ kind: "disclosure", prepared })
  }

  function choose(kind: CapabilityPluginInstallSource["kind"]): void {
    void run(async (current) => {
      const path = await bridge.pick(kind)
      if (!path || current.closed) return
      if (kind === "archive") setStep({ kind, path })
      else await prepare(current, { kind, path })
    })
  }

  function dismissDisclosure(): void {
    const current = owner.current
    if (!current || current.busy || !current.preparedId) return
    cancelPrepared(bridge, current.preparedId)
    current.preparedId = null
    setStep(null)
  }

  function confirm(): void {
    void run(async (current) => {
      const confirmationId = current.preparedId
      if (!confirmationId) return
      current.preparedId = null
      try {
        await bridge.confirm(confirmationId)
        if (!current.closed) onInstalled()
      } catch (cause: unknown) {
        cancelPrepared(bridge, confirmationId)
        throw cause
      } finally {
        if (!current.closed) setStep(null)
      }
    })
  }

  const disableSource = busy || step !== null
  return (
    <>
      <Menu.Root>
        <Menu.Trigger disabled={disableSource} render={<Button type="button" variant="primary" />}>
          <Plus className="ic ic-sm" aria-hidden="true" />
          {t("pluginSettings.add")}
          <ChevronDown className="ic ic-xs" aria-hidden="true" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="end" sideOffset={4}>
            <Menu.Popup>
              <Menu.Item onClick={() => choose("archive")}>
                <Download className="ic ic-sm" aria-hidden="true" />
                {t("pluginSettings.installArchive")}
              </Menu.Item>
              {developerMode ? (
                <Menu.Item onClick={() => choose("directory")}>
                  <FolderOpen className="ic ic-sm" aria-hidden="true" />
                  {t("pluginSettings.installDirectory")}
                </Menu.Item>
              ) : null}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {step?.kind === "archive" ? (
        <InstallDialog
          open
          inputId={digestId}
          labels={{
            title: t("pluginSettings.archiveTitle"),
            description: step.path.split(/[\\/]/).at(-1) ?? "",
            spec: t("pluginSettings.digestLabel"),
            placeholder: t("pluginSettings.digestPlaceholder"),
            chooseFolder: t("pluginSettings.installDirectory"),
            trust: t("pluginSettings.archiveDescription"),
            cancel: t("pluginSettings.cancel"),
            close: t("pluginSettings.close"),
            submit: t("pluginSettings.review"),
            installing: t("pluginSettings.reviewing"),
            failed: "{reason}",
          }}
          onOpenChange={(open) => {
            if (!open) setStep((current) => (current?.kind === "archive" ? null : current))
          }}
          onInstall={(sha256) =>
            run(async (current) => {
              if (!/^[0-9a-f]{64}$/i.test(sha256)) throw new Error("PLUGIN_ARCHIVE_SHA256_INVALID")
              await prepare(current, { kind: "archive", path: step.path, sha256 })
            }, true)
          }
        />
      ) : null}
      {step?.kind === "disclosure" ? (
        <PluginInstallDisclosure
          facts={pluginInstallDisclosure(step.prepared, t)}
          busy={busy}
          onCancel={dismissDisclosure}
          onConfirm={confirm}
        />
      ) : null}
    </>
  )
}
