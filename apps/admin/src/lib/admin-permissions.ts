// 负责按照当前服务端显式权限判断后台能力，不扩展任何 wildcard 或只读标记。
/** 仅接受所请求业务权限的精确成员匹配。 */
export function canAdminPermission(permissions: readonly string[], permission: string): boolean {
  return permissions.includes(permission)
}

/** 等级管理区只接受活跃管理员和精确读写权限。 */
export function tierPermissions(
  me: { status: string; permissions?: readonly string[] } | undefined,
) {
  const canRead =
    me?.status === "active" && canAdminPermission(me.permissions ?? [], "membership:read")
  return {
    canRead,
    canWrite: canRead && canAdminPermission(me?.permissions ?? [], "membership:tiers:write"),
  }
}
