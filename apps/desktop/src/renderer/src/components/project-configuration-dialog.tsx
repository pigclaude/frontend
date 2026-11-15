// 展示脱敏的项目配置，并在保存或撤销信任前向用户显示本次确认的报告。
import { useEffect, useState, type ReactNode } from "react"
import type {
  ProjectConfigurationBridge,
  ProjectConfigurationReport,
  ProjectTrustConfirmation,
} from "../../../project-configuration-contract"
import { fill, useText } from "../locale/text"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog"

/** 两个入口共享同一个项目配置对话框，只在桌面桥存在时提供打开动作。 */
export function useProjectConfigurationDialog(): {
  open: ((path: string) => void) | undefined
  dialog: ReactNode
} {
  const [path, setPath] = useState<string | null>(null)
  const bridge = window.pigclaude?.projectConfiguration
  return {
    open: bridge ? setPath : undefined,
    dialog:
      path && bridge ? (
        <ProjectConfigurationDialog
          key={`configuration:${path}`}
          path={path}
          bridge={bridge}
          onClose={() => setPath(null)}
        />
      ) : null,
  }
}

function ProjectConfigurationDialog({
  path,
  bridge,
  onClose,
}: {
  path: string
  bridge: ProjectConfigurationBridge
  onClose: () => void
}) {
  const { t } = useText()
  const [report, setReport] = useState<ProjectConfigurationReport | null>(null)
  const [confirmation, setConfirmation] = useState<ProjectTrustConfirmation | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<"read" | "changed" | null>(null)

  useEffect(() => {
    let current = true
    void bridge.report(path).then(
      (value) => {
        if (current) setReport(value)
      },
      () => {
        if (current) setError("read")
      },
    )
    return () => {
      current = false
    }
  }, [bridge, path])

  async function accept(trusted: boolean): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (confirmation) {
        setReport(await bridge.confirm(confirmation.id))
        setConfirmation(null)
      } else {
        setConfirmation(await bridge.prepare(path, trusted))
      }
    } catch (cause) {
      const changed =
        cause instanceof Error && cause.message.includes("PROJECT_CONFIGURATION_CHANGED")
      setError(changed ? "changed" : "read")
      setConfirmation(null)
      if (changed) await bridge.report(path).then(setReport, () => undefined)
    } finally {
      setBusy(false)
    }
  }

  const shown = confirmation?.report ?? report
  const grant = confirmation?.trusted ?? shown?.trust !== "trusted"
  const action = confirmation
    ? t(grant ? "shell.projectConfig.confirmTrust" : "shell.projectConfig.confirmRevoke")
    : t(grant ? "shell.projectConfig.trust" : "shell.projectConfig.revoke")
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent>
        <div className="dialog-head">
          <div className="dialog-heading">
            <DialogTitle className="dialog-title">{t("shell.projectConfig.title")}</DialogTitle>
            <DialogDescription className="dialog-desc">
              {confirmation
                ? t(
                    grant
                      ? "shell.projectConfig.confirmDescription"
                      : "shell.projectConfig.revokeDescription",
                  )
                : (shown?.workspace ?? path)}
            </DialogDescription>
          </div>
        </div>
        {error ? (
          <p className="error-text" role="alert">
            {t(
              error === "changed"
                ? "shell.projectConfig.changed"
                : "shell.projectConfig.unavailable",
            )}
          </p>
        ) : null}
        {shown ? (
          <ReportDetails report={shown} />
        ) : !error ? (
          <p role="status">{t("shell.projectConfig.loading")}</p>
        ) : null}
        <div className="dialog-foot">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => (confirmation ? setConfirmation(null) : onClose())}
          >
            {t(confirmation ? "shell.projectConfig.cancel" : "shell.projectConfig.close")}
          </Button>
          {shown && shown.trust !== "blocked" ? (
            <Button
              disabled={busy || (grant && shown.unreadable.length > 0)}
              variant="primary"
              onClick={() => void accept(grant)}
            >
              {action}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ReportDetails({ report }: { report: ProjectConfigurationReport }) {
  const { t } = useText()
  const rows: Array<{ label: string; items: string[] }> = [
    { label: t("shell.projectConfig.status"), items: [t(`shell.projectConfig.${report.trust}`)] },
    { label: t("shell.projectConfig.instructions"), items: report.instructions },
    {
      label: t("shell.projectConfig.items"),
      items: [fill(t("shell.projectConfig.counts"), report.counts)],
    },
    {
      label: t("shell.projectConfig.hooks"),
      items: report.hooks.map(({ event, kind, command }) => `${event} · ${command ?? kind}`),
    },
    { label: t("shell.projectConfig.environment"), items: report.environment },
    {
      label: t("shell.projectConfig.servers"),
      items: report.servers.map(({ name, command }) => (command ? `${name} · ${command}` : name)),
    },
    {
      label: t("shell.projectConfig.credentials"),
      items: report.credentialScripts.map(({ name, command }) => `${name} · ${command}`),
    },
    {
      label: t("shell.projectConfig.skills"),
      items: report.skillExecution.map((skill) =>
        [
          skill.name,
          ...(skill.inline ? [t("shell.projectConfig.inline")] : []),
          ...(skill.hooks ? ["hooks"] : []),
          ...(skill.allowedTools ? ["allowed-tools"] : []),
        ].join(" · "),
      ),
    },
    {
      label: t("shell.projectConfig.shadowed"),
      items: report.shadowedCommands.map((name) => `/${name}`),
    },
  ]
  if (report.unreadable.length > 0)
    rows.push({
      label: t("shell.projectConfig.unreadable"),
      items: report.unreadable,
    })
  return (
    <dl className="project-configuration-report">
      {rows.map(({ label, items }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>
            {items.length === 0 ? "—" : items.map((item, index) => <span key={index}>{item}</span>)}
          </dd>
        </div>
      ))}
    </dl>
  )
}
