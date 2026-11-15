// 以纯文本展示 Claude Code 插件可加载的组件和原安装披露记录。

import type {
  ClaudeCodePluginIgnoredComponent,
  ClaudeCodePluginManifest,
} from "../../../../capability-plugin-contract"
import { useText, type TextKey } from "../../locale/text"

const ignoredLabels: Record<ClaudeCodePluginIgnoredComponent, TextKey> = {
  hooks: "pluginSettings.ignoredHooks",
  mcp: "pluginSettings.ignoredMcp",
  lsp: "pluginSettings.ignoredLsp",
}

/** 在安装披露或详情的定义列表中显示组件分类、忽略项和 Skill 执行声明。 */
export function ClaudeCodePluginFacts({ manifest }: { manifest: ClaudeCodePluginManifest }) {
  const { t } = useText()
  const none = t("pluginSettings.none")
  const skillExecution = manifest.skillExecution
    .map(({ name, inline, hooks, allowedTools }) => ({
      name,
      description: [
        inline && t("pluginSettings.skillInline"),
        hooks && t("pluginSettings.skillHooks"),
        allowedTools && t("pluginSettings.skillAllowedTools"),
      ]
        .filter(Boolean)
        .join(" · "),
    }))
    .filter(({ description }) => description.length > 0)
  return (
    <>
      <dt>{t("pluginSettings.claudeCommands")}</dt>
      <dd className="mono">{manifest.commands.join(", ") || none}</dd>
      <dt>{t("pluginSettings.claudeSkills")}</dt>
      <dd className="mono">{manifest.skills.join(", ") || none}</dd>
      <dt>{t("pluginSettings.claudeAgents")}</dt>
      <dd className="mono">{manifest.agents.join(", ") || none}</dd>
      <dt>{t("pluginSettings.ignored")}</dt>
      <dd>
        {manifest.ignoredComponents.map((component) => t(ignoredLabels[component])).join(", ") ||
          none}
      </dd>
      <dt>{t("pluginSettings.skillExecution")}</dt>
      <dd>
        {skillExecution.length > 0 ? (
          <ul className="plugin-disclosure-tools">
            {skillExecution.map(({ name, description }) => (
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
    </>
  )
}
