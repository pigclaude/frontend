// 显示存在本机的项目授权，并在主进程确认撤销后刷新列表。

import { useEffect, useState } from "react"
import { Button, SettingRow, SettingSection } from "@pigclaude/ui-primitives"
import {
  projectPermissionCleanupFailed,
  type ProjectPermissionEntry,
  type ProjectPermissionsBridge,
} from "../../../../project-permissions-contract"
import { useText } from "../../locale/text"

/** 展示所有项目授权的规则和归属项目；可按条撤销。 */
export function ProjectPermissionRules({ bridge }: { bridge: ProjectPermissionsBridge }) {
  const { t } = useText()
  const [entries, setEntries] = useState<ProjectPermissionEntry[] | null>(null)
  const [error, setError] = useState<"request" | "cleanup" | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let alive = true
    void bridge.list().then(
      (rules) => {
        if (alive) setEntries(rules)
      },
      () => {
        if (alive) setError("request")
      },
    )
    return () => {
      alive = false
    }
  }, [bridge])

  async function revoke(id: string): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      setEntries(await bridge.revoke(id))
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes(projectPermissionCleanupFailed)) {
        setError("cleanup")
        await bridge.list().then(setEntries, () => undefined)
      } else setError("request")
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingSection title={t("permission.rules.title")}>
      {error ? (
        <p role="alert">
          {t(error === "cleanup" ? "permission.rules.cleanupFailed" : "permission.rules.error")}
        </p>
      ) : null}
      {entries?.length === 0 ? <SettingRow title={t("permission.rules.empty")} /> : null}
      {entries?.map(({ id, projectPath, value }) => (
        <SettingRow key={id} title={value} description={projectPath}>
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => void revoke(id)}>
            {t("permission.rules.revoke")}
          </Button>
        </SettingRow>
      ))}
    </SettingSection>
  )
}
