// 负责本人网站登录会话列表的正式契约。
/** 网页登录列表项；id 是 RP 会话 ID，不是设备 ID。 */
export interface WebSessionView {
  id: string
  browser: string
  os: string
  createdAt: string
  lastSeenAt: string
  createdIp: string | null
  lastIp: string | null
  isCurrent: boolean
}
