// 负责给浏览器输入工具的参数里写进密码框的内容打码：单个输入（ref、selector、text）和
// 表单填写（fields 里的 name、type、value）。只认参数里能看出来的密码标记；
// 只有元素 ref、没有任何密码标记的输入看不出是不是密码框。

import { isPlainRecord } from "./session-store-guards"

/** 密码打码后的固定占位，不保留原文长度。 */
export const maskedSecret = "[已打码]"

const mcpPrefix = /^mcp__[^_]+(?:_[^_]+)*__/
const secretKeys = /^(password|passwd|pwd|passcode|密码)$/i
const secretFlags = ["password", "secret", "sensitive", "isPassword"]
const typeKeys = ["type", "inputType", "fieldType", "kind"]
const targetKeys = ["ref", "selector", "element", "label", "name", "field", "target", "placeholder"]
const targetPattern = /password|passwd|pwd|密码|口令/i
const valueKeys = ["text", "value", "values", "keys", "input", "content"]

/**
 * 浏览器工具（名字去掉 MCP 前缀后以 browser_ 开头）的参数里，密码框的输入值换成固定占位；
 * 其他工具的参数原样返回。不修改传入的对象。
 */
export function maskBrowserSecrets<T>(toolName: string, input: T): T {
  if (!/^browser_/i.test(toolName.replace(mcpPrefix, ""))) return input
  return maskValue(input) as T
}

function maskValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskValue)
  if (!isPlainRecord(value)) return value
  const target = isPasswordTarget(value)
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (typeof item === "string" && (secretKeys.test(key) || (target && valueKeys.includes(key))))
        return [key, maskedSecret]
      if (target && key === "values" && Array.isArray(item))
        return [key, item.map(() => maskedSecret)]
      return [key, maskValue(item)]
    }),
  )
}

function isPasswordTarget(value: Record<string, unknown>): boolean {
  return (
    secretFlags.some((key) => value[key] === true) ||
    typeKeys.some((key) => {
      const type = value[key]
      return typeof type === "string" && type.toLowerCase() === "password"
    }) ||
    targetKeys.some((key) => {
      const target = value[key]
      return typeof target === "string" && targetPattern.test(target)
    })
  )
}
