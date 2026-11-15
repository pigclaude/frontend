// 把用户选择的 SDK 建议转换成可以存到本机、经 flag 设置注入的项目授权。

import type { PermissionUpdate, Settings } from "@anthropic-ai/claude-agent-sdk"
import { isAbsolute } from "node:path"
import type { ProjectPermissionGrant } from "../../project-permissions-contract"

/** 可以随会话启动和运行中热更新的权限对象。 */
export type ProjectPermissionSettings = NonNullable<Settings["permissions"]>

/** 仅保存增加允许规则和增加目录的建议；模式变更、删除或覆盖操作不属于固定授权。 */
export function projectPermissionGrants(update: PermissionUpdate): ProjectPermissionGrant[] {
  if (update.type === "addRules" && update.behavior === "allow") {
    return update.rules.map(({ toolName, ruleContent }) => ({
      kind: "allow",
      value: ruleContent === undefined ? toolName : `${toolName}(${ruleContent})`,
    }))
  }
  if (update.type === "addDirectories" && update.directories.every(isAbsolute)) {
    return update.directories.map((value) => ({ kind: "directory", value }))
  }
  return []
}

/** 每次返回整份项目权限对象，包括撤销最后一条规则后的空列表。 */
export function projectPermissionSettings(
  grants: readonly ProjectPermissionGrant[],
): ProjectPermissionSettings {
  return {
    allow: grants.filter(({ kind }) => kind === "allow").map(({ value }) => value),
    additionalDirectories: grants
      .filter(({ kind }) => kind === "directory")
      .map(({ value }) => value),
  }
}
