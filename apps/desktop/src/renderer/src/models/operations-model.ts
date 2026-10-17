// 负责用量筛选、端口校验和隐私操作的纯状态逻辑。

/** 用量请求记录的最小展示字段。 */
export type UsageRow = {
  id: string
  kind: "all" | "switch" | "error"
  model: string
  status: number
  time?: string
  account?: string
  input?: number
  output?: number
}

/** 用量请求记录筛选条件。 */
export type UsageFilter = "all" | "switch" | "error"

/** 清除用量弹层状态。 */
export type PrivacyState = { open: boolean; cleared: boolean }

/** 清除用量状态变化事件。 */
export type PrivacyEvent =
  { type: "open-clear" } | { type: "cancel-clear" } | { type: "confirm-clear" }

/** 按请求类型筛选用量记录。 */
export function filterUsageRows(rows: UsageRow[], filter: UsageFilter): UsageRow[] {
  return filter === "all" ? rows : rows.filter((row) => row.kind === filter)
}

/** 校验本机中继端口是否在允许范围内。 */
export function validateRelayPort(value: string): boolean {
  if (!/^\d+$/.test(value)) return false
  const port = Number(value)
  return port >= 1024 && port <= 65535
}

/** 按事件更新清除用量状态。 */
export function reducePrivacyState(state: PrivacyState, event: PrivacyEvent): PrivacyState {
  if (event.type === "open-clear") return { ...state, open: true }
  if (event.type === "cancel-clear") return { ...state, open: false }
  return { open: false, cleared: true }
}
