// 负责保持 Rust AdminContext 的精确权限、全局权限及既有只读授权语义。
/** 判断权限集合是否具备指定能力，未知分组 wildcard 不自动扩权。 */
export function canAdminPermission(permissions: readonly string[], permission: string): boolean {
  return permissions.some(
    (value) =>
      value === "*" ||
      value === "admin:*" ||
      value === permission ||
      (permission.startsWith("membership:") && value === "membership:*") ||
      (permission.startsWith("device:") && value === "device:*") ||
      (permission.endsWith(":read") && value === "read"),
  )
}
