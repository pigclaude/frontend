// 负责跳转第三方核验前记下正在进行的敏感操作，回来后只续接一次，超过 10 分钟作废。
import type { SensitiveOperation } from "@pigclaude/api/home/identity"

const KEY = "pigclaude.pendingSensitiveOperation"
const MAX_AGE_MS = 10 * 60_000

function isOperation(value: unknown): value is SensitiveOperation {
  if (typeof value !== "object" || value === null) return false
  const operation = (value as { operation?: unknown }).operation
  if (operation === "change_email" || operation === "revoke_all_devices") return true
  if (operation === "link" || operation === "unlink") {
    const provider = (value as { provider?: unknown }).provider
    return provider === "google" || provider === "github"
  }
  if (operation === "revoke_device") {
    const device = value as { device_id?: unknown; expected_binding_epoch?: unknown }
    return typeof device.device_id === "string" && typeof device.expected_binding_epoch === "string"
  }
  return false
}

/** 记下即将跳去供应商核验的操作；存储不可用时静默放弃，用户回来后重新点一次即可。 */
export function savePending(op: SensitiveOperation): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ op, savedAt: Date.now() }))
  } catch {
    // 隐私模式等情况下 sessionStorage 不可写，续接只是便利，不影响安全。
  }
}

/** 取出并删除记下的操作；格式不对或超过 10 分钟时返回 null。 */
export function takePending(): SensitiveOperation | null {
  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { op?: unknown; savedAt?: unknown }
    if (typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > MAX_AGE_MS) return null
    if (parsed.savedAt > Date.now()) return null
    return isOperation(parsed.op) ? parsed.op : null
  } catch {
    return null
  }
}
