// 在用户确认前展示本机插件的类型、权限、域名、工具和执行项。

import { Badge, Button, Dialog } from "@pigclaude/ui-primitives"
import { TriangleAlert } from "lucide-react"
import type { PluginMarketplaceEntryView } from "../../../../plugin-marketplace-contract"
import { useText } from "../../locale/text"
import { ClaudeCodePluginFacts } from "./claude-code-plugin-facts"
import { MarketplaceReviewBadge } from "./plugin-marketplace-catalog"
import { marketplacePermissionChangeText } from "./plugin-marketplace-view"
import type { PluginDisclosureFacts } from "./plugin-settings-view"

/** 宿主对手动更新计算出的新增范围和插件包变化。 */
export type PluginUpdateDisclosure = {
  additionalPermissions: readonly string[]
  additionalDomains: readonly string[]
  fileHashChanged?: true
}

/** 披露对话框只展示已准备的事实，由宿主处理确认和放弃。 */
export function PluginInstallDisclosure({
  facts,
  sourceName,
  reviewStatus,
  update,
  busy,
  onCancel,
  onConfirm,
}: {
  facts: PluginDisclosureFacts
  sourceName?: string | undefined
  reviewStatus?: PluginMarketplaceEntryView["reviewStatus"]
  update?: PluginUpdateDisclosure | undefined
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useText()
  const description = [facts.name, facts.version, sourceName].filter(Boolean).join(" · ")
  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onCancel()}>
      <Dialog.Content
        className="plugin-disclosure"
        title={t(update ? "pluginMarketplace.updateDisclosure" : "pluginSettings.disclosure")}
        description={description}
        closeLabel={t("pluginSettings.close")}
        closeDisabled={busy}
      >
        <Dialog.Body className="plugin-dialog-body">
          {reviewStatus ? (
            <div>
              <MarketplaceReviewBadge status={reviewStatus} />
            </div>
          ) : null}
          {update?.fileHashChanged ? (
            <p className="marketplace-risk">
              <TriangleAlert className="ic ic-sm" aria-hidden="true" />
              <span>{t("pluginMarketplace.fileHashChanged")}</span>
            </p>
          ) : null}
          {update && (update.additionalPermissions.length || update.additionalDomains.length) ? (
            <UpdateFacts update={update} />
          ) : null}
          <dl className="ext-facts">
            <dt>{t("pluginSettings.type")}</dt>
            <dd>{facts.typeLabel}</dd>
            {facts.type === "claude-code" ? (
              <ClaudeCodePluginFacts manifest={facts.manifest} />
            ) : (
              <CapabilityPluginFacts facts={facts} />
            )}
          </dl>
          {facts.type === "claude-code" && facts.manifest.skillExecution.length > 0 ? (
            <p className="hint">{t("pluginSettings.skillApplies")}</p>
          ) : null}
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Close render={<Button type="button" variant="ghost" disabled={busy} />}>
            {t("pluginSettings.cancel")}
          </Dialog.Close>
          <Button type="button" variant="primary" disabled={busy} onClick={onConfirm}>
            {t(
              update
                ? busy
                  ? "pluginMarketplace.updating"
                  : "pluginMarketplace.updateConfirm"
                : busy
                  ? "pluginSettings.installing"
                  : "pluginSettings.confirm",
            )}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  )
}

function UpdateFacts({ update }: { update: PluginUpdateDisclosure }) {
  const { t } = useText()
  return (
    <dl className="ext-facts marketplace-update-facts">
      {update.additionalPermissions.length ? (
        <>
          <dt>{t("pluginMarketplace.additionalPermissions")}</dt>
          <dd>
            {update.additionalPermissions.map((permission) => (
              <Badge key={permission} variant="warn">
                {marketplacePermissionChangeText(permission, t)}
              </Badge>
            ))}
          </dd>
        </>
      ) : null}
      {update.additionalDomains.length ? (
        <>
          <dt>{t("pluginMarketplace.additionalDomains")}</dt>
          <dd className="mono">{update.additionalDomains.join(", ")}</dd>
        </>
      ) : null}
    </dl>
  )
}

function CapabilityPluginFacts({
  facts,
}: {
  facts: Extract<PluginDisclosureFacts, { type: "capability" }>
}) {
  const { t } = useText()
  const none = t("pluginSettings.none")
  return (
    <>
      <dt>{t("pluginSettings.permissions")}</dt>
      <dd>
        {facts.permissions.length
          ? facts.permissions.map((permission) => <Badge key={permission}>{permission}</Badge>)
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
      <dd>{none}</dd>
      <dt>{t("pluginSettings.skillExecution")}</dt>
      <dd>{none}</dd>
    </>
  )
}
