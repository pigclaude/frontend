// 为插件设置视觉回归注入本地安装记录、模拟文件选择与固定披露，不执行插件代码。

import type { Page } from "@playwright/test"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type {
  ClaudeCodePluginManifest,
  InstalledCapabilityPlugin,
} from "../src/capability-plugin-contract"

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

const docs: InstalledCapabilityPlugin = {
  type: "capability",
  revision: "visual-1",
  installedAt: "2026-11-15T01:00:00.000Z",
  sourceKind: "archive",
  sha256: "a".repeat(64),
  enabled: true,
  compatible: true,
  toolApproval: "always_ask",
  approvedDomains: ["docs.example.org"],
  manifest: {
    id: "docs-index",
    name: "文档索引",
    description: "搜索项目文档和内部参考资料",
    apiVersion: 1,
    version: "1.2.0",
    pigclaudeVersion: "*",
    entry: "index.mjs",
    tools: [
      {
        name: "search_docs",
        description: "根据标题和关键词检索文档",
        inputSchema: { type: "object" },
      },
    ],
    permissions: ["workspace-read", "network"],
    networkDomains: ["docs.example.org"],
    settings: [],
    commands: [],
    toolResultTemplates: [],
  },
}

const summary: InstalledCapabilityPlugin = {
  ...docs,
  revision: "visual-2",
  sourceKind: "directory",
  sha256: null,
  approvedDomains: [],
  enabled: false,
  manifest: {
    ...docs.manifest,
    id: "issue-summary",
    name: "问题摘要",
    description: "从本机数据整理问题摘要",
    version: "0.4.0",
    permissions: ["storage"],
    networkDomains: [],
    tools: [],
  },
}

/** 让真实设置页面通过隔离的预览桥读取已安装插件及准备安装结果。 */
export async function installPluginSettingsPreview(
  page: Page,
  settings = false,
  claudeCode?: ClaudeCodePluginManifest,
): Promise<void> {
  const documentPlugin: InstalledCapabilityPlugin = settings
    ? {
        ...docs,
        manifest: {
          ...docs.manifest,
          permissions: [...docs.manifest.permissions, "secrets"],
          settings: [
            { key: "indexName", label: "索引名称", type: "text" },
            { key: "apiToken", label: "索引密钥", type: "secret" },
          ],
        },
      }
    : docs
  await page.addInitScript(
    ({ membership, docs, summary, claudeCode }) => {
      const unavailable = async () => {
        throw new Error("PLUGIN_MANAGEMENT_FAILED")
      }
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
          list: async () => [docs, summary],
          listDeclarations: async () => [],
          readSettings: async () => ({
            values: { indexName: "团队手册" },
            configuredSecrets: ["apiToken"],
          }),
          setSetting: unavailable,
          runCommand: unavailable,
          pick: async (kind) => (kind === "directory" ? "/fixtures/docs" : "/fixtures/docs.zip"),
          prepare: async (source) => ({
            ...(claudeCode
              ? ({ type: "claude-code", manifest: claudeCode } as const)
              : ({ type: "capability", manifest: docs.manifest } as const)),
            confirmationId: "plugin-preview",
            sourceKind: source.kind,
            sha256: source.kind === "archive" ? source.sha256 : null,
          }),
          confirm: unavailable,
          cancel: async () => undefined,
          setEnabled: unavailable,
          setToolApproval: unavailable,
          uninstall: unavailable,
          subscribe: () => () => undefined,
        },
      }
    },
    { membership, docs: documentPlugin, summary, claudeCode },
  )
}
