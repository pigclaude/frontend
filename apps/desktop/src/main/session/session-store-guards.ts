// 会话存储读磁盘时对 unknown 值的判断：解析出的 JSON 是不是普通对象，捕获的错误带什么文件错误码。

/** 是不是普通对象（不是 null，也不是数组）。 */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Node 文件错误的 code（例如 ENOENT）；不是带字符串 code 的错误时返回 null。 */
export function fileErrorCode(error: unknown): string | null {
  return isPlainRecord(error) && typeof error.code === "string" ? error.code : null
}
