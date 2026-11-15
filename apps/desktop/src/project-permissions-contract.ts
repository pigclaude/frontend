// 定义权限卡的建议索引与本机项目授权在桌面桥上的数据格式。

/** 在权限卡里选择一条 SDK 建议；序号从零开始。 */
export type PermissionSuggestionSelection = { index: number; scope: "session" | "project" }

/** 主进程提供的简短规则预览；界面只把序号和作用范围传回。 */
export type PermissionSuggestionView = {
  index: number
  label: string
  canSaveProject: boolean
  kind?: "directory"
}

/** 一条已保存的项目授权；allow 为 SDK 规则，directory 为额外目录。 */
export type ProjectPermissionGrant = { kind: "allow" | "directory"; value: string }

/** 设置页显示的项目授权；撤销使用其不透明 id。 */
export type ProjectPermissionEntry = ProjectPermissionGrant & { id: string; projectPath: string }

/** 已从本机删除授权，但至少一个旧会话未能完整停放。 */
export const projectPermissionCleanupFailed = "PROJECT_PERMISSIONS_SESSION_CLEANUP_FAILED"

/** 项目授权只由实际权限请求保存，设置页只能查询和撤销。 */
export type ProjectPermissionsBridge = {
  list(): Promise<ProjectPermissionEntry[]>
  revoke(id: string): Promise<ProjectPermissionEntry[]>
}

/** 兼容旧会话事件；只有当前格式的建议才可在卡片上选中。 */
export function isPermissionSuggestionView(value: unknown): value is PermissionSuggestionView {
  return (
    typeof value === "object" &&
    value !== null &&
    "index" in value &&
    typeof value.index === "number" &&
    Number.isSafeInteger(value.index) &&
    value.index >= 0 &&
    "label" in value &&
    typeof value.label === "string" &&
    "canSaveProject" in value &&
    typeof value.canSaveProject === "boolean" &&
    (!("kind" in value) || value.kind === "directory")
  )
}
