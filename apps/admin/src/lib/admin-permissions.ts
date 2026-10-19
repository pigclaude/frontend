// 负责按照当前服务端显式权限判断后台能力，不扩展任何 wildcard 或只读标记。
/** 仅接受所请求业务权限的精确成员匹配。 */
export function canAdminPermission(permissions: readonly string[], permission: string): boolean {
  return permissions.includes(permission)
}
