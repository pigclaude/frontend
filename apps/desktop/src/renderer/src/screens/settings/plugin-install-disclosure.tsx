// 在用户确认前展示本机插件的类型、权限、域名、工具和执行项。

import { Badge, Button, Dialog } from "@pigclaude/ui-primitives"
import { useText } from "../../locale/text"
import type { PluginDisclosureFacts } from "./plugin-settings-view"

/** 披露对话框只展示已准备的事实，由宿主处理确认和放弃。 */
export function PluginInstallDisclosure({
  facts,
  busy,
  onCancel,
  onConfirm,
}: {
  facts: PluginDisclosureFacts
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useText()
  const none = t("pluginSettings.none")
  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onCancel()}>
      <Dialog.Content
        className="plugin-disclosure"
        title={t("pluginSettings.disclosure")}
        description={`${facts.name} · ${facts.version}`}
        closeLabel={t("pluginSettings.close")}
        closeDisabled={busy}
      >
        <Dialog.Body className="plugin-dialog-body">
          <dl className="ext-facts">
            <dt>{t("pluginSettings.type")}</dt>
            <dd>{facts.typeLabel}</dd>
            <dt>{t("pluginSettings.permissions")}</dt>
            <dd>
              {facts.permissions.length
                ? facts.permissions.map((permission) => (
                    <Badge key={permission}>{permission}</Badge>
                  ))
                : none}
            </dd>
            <dt>{t("pluginSettings.domains")}</dt>
            <dd className="mono">{facts.domains.join(", ") || none}</dd>
            <dt>{t("pluginSettings.tools")}</dt>
            <dd>
              {facts.tools.length ? (
                <ul className="plugin-disclosure-tools">
                  {facts.tools.map(({ name, description }) => (
                    <li key={name}>
                      <code className="mono">{name}</code>
                      <span>{description}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                none
              )}
            </dd>
            <dt>{t("pluginSettings.ignored")}</dt>
            <dd>{facts.ignoredComponents.join(", ") || none}</dd>
            <dt>{t("pluginSettings.skillExecution")}</dt>
            <dd>{facts.skillExecution.join(", ") || none}</dd>
          </dl>
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Close render={<Button type="button" variant="ghost" disabled={busy} />}>
            {t("pluginSettings.cancel")}
          </Dialog.Close>
          <Button type="button" variant="primary" disabled={busy} onClick={onConfirm}>
            {t(busy ? "pluginSettings.installing" : "pluginSettings.confirm")}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  )
}
