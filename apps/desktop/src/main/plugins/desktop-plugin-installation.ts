// 绑定可信窗口的披露、待安装文件及市场授权，并计算手动更新的增权。

import { randomUUID } from "node:crypto"
import type {
  DesktopPluginInstallDisclosure,
  InstalledCapabilityPlugin,
  InstalledClaudeCodePlugin,
} from "../../capability-plugin-contract"
import type { DesktopPluginRecord } from "./capability-plugin-records"
import { pluginBundleFilesDigest, type DesktopPluginBundle } from "./desktop-plugin-bundle"
import type { PluginMarketplaceProvenance } from "./plugin-marketplace-catalog"

/** 市场项由主进程核验；实际发布时还须确认这次来源授权仍有效。 */
export type PluginMarketplaceInstallRequest = {
  bundle: DesktopPluginBundle
  provenance: PluginMarketplaceProvenance
  assertCurrent(): void
}

/** 包含经过验证的文件和安装期间必须保持有效的会话状态。 */
export type DesktopPluginInstallPlan = {
  bundle: DesktopPluginBundle
  sourceKind: DesktopPluginInstallDisclosure["sourceKind"]
  sha256: string | null
  epoch: number
  market?: Pick<PluginMarketplaceInstallRequest, "provenance" | "assertCurrent">
  previousRevision?: string
}

/** 市场安装与更新共用从实际下载摘要和来源核验生成的计划。 */
export function marketplaceInstallPlan(
  { bundle, provenance, assertCurrent }: PluginMarketplaceInstallRequest,
  epoch: number,
): DesktopPluginInstallPlan {
  return {
    bundle,
    sourceKind: provenance.archiveSha256 === null ? "directory" : "archive",
    sha256: provenance.archiveSha256,
    epoch,
    market: { provenance, assertCurrent },
  }
}

type Review = {
  confirmationId: string
  expires: number
  plan: DesktopPluginInstallPlan
}

/** 一次性安装披露只匹配发出请求的可信窗口。 */
export class DesktopPluginInstallReview {
  #pending = new WeakMap<object, Review>()

  /** 保存独立快照；调用方核验会员、来源和旧版本后才能发布。 */
  prepare(owner: object, plan: DesktopPluginInstallPlan): DesktopPluginInstallDisclosure {
    const { bundle, sourceKind, sha256 } = plan
    const confirmationId = randomUUID()
    this.#pending.set(owner, { plan, confirmationId, expires: Date.now() + 300_000 })
    const details = { confirmationId, sourceKind, sha256 }
    return structuredClone(
      bundle.type === "capability"
        ? { ...details, type: "capability", manifest: bundle.manifest }
        : { ...details, type: "claude-code", manifest: bundle.manifest },
    )
  }

  /** 确认请求只消费当前窗口的匹配披露，过期和旧披露都不可重放。 */
  consume(owner: object, confirmationId: string): DesktopPluginInstallPlan {
    const pending = this.#pending.get(owner)
    if (!pending || pending.confirmationId !== confirmationId || pending.expires <= Date.now())
      throw new Error("PLUGIN_CONFIRMATION_INVALID")
    this.#pending.delete(owner)
    return pending.plan
  }

  /** 清除窗口待确认内容，也可仅取消当前 ID。 */
  cancel(owner: object, confirmationId?: string): void {
    if (confirmationId === undefined || this.#pending.get(owner)?.confirmationId === confirmationId)
      this.#pending.delete(owner)
  }

  /** 会员代际变化使所有先前披露失效。 */
  reset(): void {
    this.#pending = new WeakMap()
  }
}

/** 用批准的内容生成完整记录；更新沿用已有启用和审批偏好。 */
export function createDesktopPluginRecord(
  plan: DesktopPluginInstallPlan,
  previous?: DesktopPluginRecord,
): DesktopPluginRecord {
  const { bundle, sourceKind, sha256, market } = plan
  const common = {
    revision: randomUUID(),
    installedAt: previous?.installedAt ?? new Date().toISOString(),
    sourceKind,
    sha256,
    enabled: previous?.enabled ?? true,
    ...(market === undefined ? {} : { marketplace: market.provenance }),
  }
  return bundle.type === "claude-code"
    ? {
        ...common,
        type: bundle.type,
        manifest: bundle.manifest,
        packageDigest: pluginBundleFilesDigest(bundle.files),
        menuCommands: bundle.menuCommands,
      }
    : {
        ...common,
        type: bundle.type,
        manifest: bundle.manifest,
        approvedDomains: [...bundle.manifest.networkDomains],
        toolApproval: previous?.type === "capability" ? previous.toolApproval : "always_ask",
      }
}

type PluginAccess =
  | Pick<InstalledCapabilityPlugin, "type" | "manifest">
  | Pick<InstalledClaudeCodePlugin, "type" | "manifest">

function requestedAccess(plugin: PluginAccess): { permissions: string[]; domains: string[] } {
  if (plugin.type === "capability")
    return { permissions: plugin.manifest.permissions, domains: plugin.manifest.networkDomains }
  return {
    domains: [],
    permissions: plugin.manifest.skillExecution.flatMap((execution) => [
      ...(execution.inline ? ["skill-inline:" + execution.name] : []),
      ...(execution.hooks ? ["skill-hooks:" + execution.name] : []),
      ...(execution.allowedTools ? ["skill-allowed-tools:" + execution.name] : []),
    ]),
  }
}

/** 依据实际校验的包比较能力和域名；Claude Code 同样披露新增的执行项。 */
export function expandedPluginAccess(previous: PluginAccess, candidate: PluginAccess) {
  const before = requestedAccess(previous)
  const after = requestedAccess(candidate)
  return {
    additionalPermissions: after.permissions.filter(
      (permission) => !before.permissions.includes(permission),
    ),
    additionalDomains: after.domains.filter((domain) => !before.domains.includes(domain)),
  }
}
