// 为真实插件页面提供合成市场状态与一次扩权更新披露。

import type { Page } from "@playwright/test"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type {
  PluginMarketplaceUpdateResult,
  PluginMarketplaceView,
} from "../src/plugin-marketplace-contract"

const membership: MembershipView = {
  startupPhase: "settled",
  revision: 1,
  state: "active",
  account: { userId: "sample", nickname: "小猪", email: "sample@example.org", avatar: "" },
  tier: null,
  membershipValidUntil: null,
  offlineValidUntil: null,
  lastVerifiedAt: null,
  nextVerificationAt: null,
  bindingEpoch: null,
  errorCode: null,
  serverReason: null,
  authorizationUrl: null,
}

const marketplace: PluginMarketplaceView = {
  developerMode: true,
  thirdPartyEnabled: true,
  sources: [
    {
      id: "docs-market",
      kind: "github",
      label: "team/plugin-catalog",
      catalogName: "团队工具目录",
      enabled: true,
      refreshedAt: "2026-11-15T03:00:00.000Z",
      entryCount: 3,
      error: null,
      pin: "a".repeat(40),
    },
    {
      id: "archive-market",
      kind: "https",
      label: "https://example.org/catalog.tgz",
      catalogName: "研发归档",
      enabled: false,
      refreshedAt: null,
      entryCount: 0,
      error: null,
      pin: "b".repeat(64),
    },
  ],
  entries: [
    {
      id: "docs-index",
      sourceId: "docs-market",
      name: "文档索引",
      type: "capability",
      description: "为项目文档提供检索工具",
      version: "1.3.0",
      author: "文档团队",
      permissions: ["workspace-read", "network"],
      domains: ["docs.example.org"],
      action: "update",
      reviewStatus: "unreviewed",
    },
    {
      id: "release-guide",
      sourceId: "docs-market",
      name: "发布指南",
      type: "claude-code",
      description: "发布流程的技能与审查命令",
      version: "1.0.0",
      author: "发布团队",
      permissions: [],
      domains: [],
      action: "install",
      reviewStatus: "unreviewed",
    },
    {
      id: "issue-summary",
      sourceId: "docs-market",
      name: "问题摘要",
      type: "capability",
      description: "整理本机问题摘要",
      version: "0.4.0",
      author: "研发团队",
      permissions: ["storage"],
      domains: [],
      action: "installed",
      reviewStatus: "unreviewed",
    },
  ],
}

const update: PluginMarketplaceUpdateResult = {
  kind: "review",
  additionalPermissions: ["network"],
  additionalDomains: ["docs.example.org"],
  fileHashChanged: true,
  disclosure: {
    type: "capability",
    confirmationId: "review-preview",
    sourceKind: "archive",
    sha256: "c".repeat(64),
    manifest: {
      apiVersion: 1,
      id: "docs-index",
      name: "文档索引",
      version: "1.3.0",
      pigclaudeVersion: "*",
      entry: "index.mjs",
      description: "为项目文档提供检索工具",
      tools: [
        { name: "search_docs", description: "根据标题查询文档", inputSchema: { type: "object" } },
      ],
      permissions: ["workspace-read", "network"],
      networkDomains: ["docs.example.org"],
      settings: [],
      commands: [],
      toolResultTemplates: [],
    },
  },
}

/** 装入可读取的缓存和待确认包，所有操作仅在预览夹具内处理。 */
export async function installPluginMarketplacePreview(page: Page, enabled = true): Promise<void> {
  await page.addInitScript(
    ({ membership, marketplace, update }) => {
      const unavailable = async () => {
        throw new Error("FIXTURE_UNEXPECTED_CALL")
      }
      let thirdPartyEnabled = marketplace.thirdPartyEnabled
      window.pigclaude = {
        platform: "darwin",
        membership: {
          inspect: async () => membership,
          subscribe: () => () => undefined,
          withdraw: unavailable,
          signOut: unavailable,
        },
        capabilityPlugins: {
          status: async () => ({ developerMode: true }),
          list: async () => [],
          listDeclarations: async () => [],
          readSettings: unavailable,
          setSetting: unavailable,
          runCommand: unavailable,
          pick: unavailable,
          prepare: unavailable,
          confirm: unavailable,
          cancel: async () => undefined,
          setEnabled: unavailable,
          setToolApproval: unavailable,
          uninstall: unavailable,
          subscribe: () => () => undefined,
        },
        pluginMarketplace: {
          list: async () => ({ ...marketplace, thirdPartyEnabled }),
          setThirdPartyEnabled: async (next) => {
            thirdPartyEnabled = next
          },
          selectDirectory: unavailable,
          add: unavailable,
          refresh: unavailable,
          setEnabled: unavailable,
          remove: unavailable,
          prepareInstall: unavailable,
          prepareUpdate: async () => update,
          subscribe: () => () => undefined,
        },
      }
    },
    { membership, marketplace: { ...marketplace, thirdPartyEnabled: enabled }, update },
  )
}
